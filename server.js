const {launch, connect} = require('hadouken-js-adapter');
const express = require('express');
const webpack = require('webpack');
const webpackDevMiddleware = require('webpack-dev-middleware');
const os = require('os');
const path = require('path');

const {PORT, SERVICE_NAME, CDN_LOCATION} = require('./scripts/server/config');
const {createCustomManifestMiddleware, getProviderUrl, readJsonFile} = require('./scripts/server/spawn');


/**
 * Chooses which version of the provider to run against. Will default to building and running a local version of the provider.
 * 
 * - "local"
 *   Starts a local version of the provider, built from the code in 'src/provider'
 * - "stable"
 *   Runs the latest public release of the service from the OpenFin CDN
 * - "staging"
 *   Runs the latest internal build of the service from the OpenFin CDN. May be unstable.
 * - <version number>
 *   Specifiying a "x.y.z" version number will load that version of the service from the OpenFin CDN.
 */
const providerVersion = getArg('--version', true, 'local');

/**
 * The mode to use for webpack, either 'development' (default) or 'production'.
 */
const mode = getArg('--mode', true, 'development');

/**
 * If the demo application should be launched after building (default: true).
 * 
 * Otherwise will build and start the local server, but not automatically launch any applications.
 */
const launchApp = !getArg('--noLaunch', false);

/**
 * Rather than building the application via webpack (and then watching for any source file changes), will launch the
 * provider from pre-built code within the 'dist' directory.
 * 
 * You should first build the provider using either 'npm run build' or 'npm run build:dev'. This option has no effect if
 * '--version' is set to anything other than 'local'.
 */
const static = getArg('--static', false);

/**
 * By default, webpack-dev-server builds and serves files from memory without writing to disk. Using this option will
 * also write the output to the 'dist' folder, as if running one of the 'build' scripts.
 */
const writeToDisk = getArg('--write', false);

// Start local server
(async () => {
    const app = await createServer();

    console.log('Starting application server...');
    app.listen(PORT, async () => {
        // Manually start service on Mac OS (no RVM support)
        if (os.platform() === 'darwin') {
            console.log('Starting Provider for Mac OS');
        
            // Launch latest stable version of the service
            await launch({manifestUrl: getProviderUrl(providerVersion)}).catch(console.log);
        }

        // Launch application, if requested to do so
        if (launchApp) {
            const manifestPath = 'demo/app.json';

            console.log('Launching application');
            connect({uuid: 'wrapper', manifestUrl: `http://localhost:${PORT}/${manifestPath}`}).then(async fin => {
                const service = fin.Application.wrapSync({uuid: 'layouts-service', name: 'layouts-service'});

                // Terminate local server when the demo app closes
                service.addListener('closed', async () => {
                    process.exit(0);
                }).catch(console.error);
            }, console.error);
        } else {
            console.log('Local server running');
        }
    });
})();

/**
 * Adds the necessary middleware to the express instance
 * 
 * - Will serve static resources from the 'res' directory
 * - Will serve application code from the 'src' directory
 *   - Uses webpack middleware to first build the application
 *   - Middleware runs webpack in 'watch' mode; any changes to source files will trigger a partial re-build
 * - Any 'app.json' files within 'res' are pre-processed
 *   - Will explicitly set the provider URL for the service
 */
async function createServer() {
    const app = express();

    // Add special route for any 'app.json' files - will re-write the contents according to the command-line arguments of this server
    app.use(/\/?(.*app\.json)/, createAppJsonMiddleware());

    // Add endpoint for creating new application manifests from scratch - used within demo app for lauching 'custom' applications
    app.use('/manifest', createCustomManifestMiddleware());

    // Add route for serving static resources
    app.use(express.static('res'));

    // Add route for code
    if (static) {
        // Run application using pre-built code (use 'npm run build' or 'npm run build:dev')
        app.use(express.static('dist'));
    } else {
        // Run application using webpack-dev-middleware. Will build app before launching, and watch for any source file changes
        app.use(await createWebpackMiddleware());
    }

    return app;
}


/**
 * Simple command-line parser. Returns the named argument from the list of process arguments.
 * 
 * @param {string} name Argument name, including any hyphens
 * @param {boolean} hasValue If this argument requires a value. Accepts "--name value" and "--name=value" syntax.
 * @param {any} defaultValue Determines return value, if an argument with the given name doesn't exist. Only really makes sense when 'hasValue' is true.
 */
function getArg(name, hasValue, defaultValue = hasValue ? null : false) {
    const unusedArgs = global.unusedArgs = (global.unusedArgs || process.argv.slice(2).map(arg => arg.toLowerCase()));
    let value = defaultValue;
    let argIndex = unusedArgs.indexOf(name.toLowerCase());

    if (argIndex >= 0 && argIndex < unusedArgs.length - (hasValue ? 1 : 0)) {
        if (hasValue) {
            // Take the argument after this as being the value
            value = unusedArgs[argIndex + 1];
            unusedArgs.splice(argIndex, 2);
        } else {
            // Only consume the one argument
            value = true;
            unusedArgs.splice(argIndex, 1);
        }
    } else if (hasValue) {
        argIndex = unusedArgs.findIndex((arg) => arg.indexOf(name + '=') === 0);
        if (argIndex >= 0) {
            value = unusedArgs[argIndex].substr(unusedArgs[argIndex].indexOf('=') + 1);
            unusedArgs.splice(argIndex, 1);
        }
    }

    return value;
}

/**
 * Creates express-compatible middleware function that will add/replace any URL's found within app.json files according
 * to the command-line options of this utility.
 */
function createAppJsonMiddleware() {
    return async (req, res, next) => {
        const configPath = req.params[0];           // app.json path, relative to 'res' dir
        const component = configPath.split('/')[0]; // client, provider or demo

        // Parse app.json
        const config = await readJsonFile(path.resolve('res', configPath)).catch(next);
        const serviceDefinition = (config.services || []).find(service => service.name === SERVICE_NAME);
        const startupUrl = config.startup_app && config.startup_app.url;

        // Edit manifest
        if (startupUrl) {
            // Replace startup app with HTML served locally
            config.startup_app.url = startupUrl.replace(CDN_LOCATION, `http://localhost:${PORT}/${component}`);
        }
        if (serviceDefinition) {
            // Replace provider manifest URL with the requested version
            serviceDefinition.manifestUrl = getProviderUrl(providerVersion, serviceDefinition.manifestUrl);
        }

        // Return modified JSON to client
        res.header('Content-Type', 'application/json; charset=utf-8');
        res.send(JSON.stringify(config, null, 4));
    };
}

/**
 * Creates express-compatible middleware function to serve webpack modules.
 * 
 * Wrapper will immediately terminate the server if the initial build fails.
 * 
 * This is a wrapper around the webpack-dev-middleware utility.
 */
async function createWebpackMiddleware() {
    return new Promise((resolve) => {
        // Load config and set development mode
        const config = require('./webpack.config.js');
        config.forEach(entry => entry.mode = (entry.mode || mode));

        // Create express middleware
        const compiler = webpack(config);
        const middleware = webpackDevMiddleware(compiler, {
            publicPath: '/',
            writeToDisk
        });

        // Wait until initial build has finished before starting application
        const startTime = Date.now();
        middleware.waitUntilValid((result) => {
            // Output build times
            const buildTimes = result.stats.map(stats => {
                const component = path.relative('./dist', stats.compilation.outputOptions.path);
                return `${component}: ${(stats.endTime - stats.startTime) / 1000}s`;
            });
            console.log(`\nInitial build complete after ${(Date.now() - startTime) / 1000} seconds\n    ${buildTimes.join('\n    ')}\n`);

            // Check build status
            if (result.stats.find(stats => stats.compilation.errors.length > 0)) {
                console.error('Build failed. See output above.');
                process.exit(1);
            } else {
                resolve(middleware);
            }
        });
    });
}
