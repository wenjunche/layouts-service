import {_Window} from 'hadouken-js-adapter/out/types/src/api/window/window';

import {register, deregister, snapAndDock, tabbing, tabstrip, workspaces} from '../client/main';

import * as Storage from './storage';
import {addSpawnListeners, AppData, createApp, WindowData, createWindow} from './spawn';
import {Workspace} from '../client/workspaces';

export interface SavedWorkspace {
    id: string;
    layout: Workspace;
}

const launchDir = location.href.slice(0, location.href.lastIndexOf('/'));

const appTemplates: {[key: string]: AppData} = {
    'manifest': {type: 'manifest', id: 'App-1', position: 'center', size: {x: 1024, y: 800}},
    'programmatic': {type: 'programmatic', id: 'App-2', position: 'center', size: {x: 1024, y: 800}},
    'script': {type: 'programmatic', id: 'App-3', position: 'center', url: 'http://localhost:1337/demo/libScriptIncluded.html'},
    'random-manifest': {type: 'manifest', position: 'center', size: {x: 1024, y: 800}},
    'random-programmatic': {type: 'programmatic', position: 'center', size: {x: 1024, y: 800}},
    'deregistered': {position: 'center', config: {enabled: false}},
    'tab-default': {position: 'center', size: {x: 400, y: 300}, queryArgs: {section: 'tabbing'}},
    'tab-custom1': {
        position: 'center',
        size: {x: 400, y: 300},
        queryArgs: {section: 'tabbing'},
        config: {tabstrip: {url: 'http://localhost:1337/demo/tabstrips/custom1.html', height: 60}}
    },
    'tab-custom2': {
        position: 'center',
        size: {x: 400, y: 300},
        queryArgs: {section: 'tabbing'},
        config: {tabstrip: {url: 'http://localhost:1337/demo/tabstrips/custom2.html', height: 60}}
    }
};
const windowTemplates: {[key: string]: WindowData} = {
    'large': {position: 'center', size: {x: 1024, y: 800}},
    'medium': {position: 'center', size: {x: 600, y: 400}}
};

export async function deregisterManager(): Promise<void> {
    await deregister();
}
export async function reregisterManager(): Promise<void> {
    await register();
}

export async function createTemplateApp(templateName: keyof typeof appTemplates): Promise<void> {
    const template = appTemplates[templateName];

    if (template) {
        await createApp(template);
    }
}

export async function createTemplateWindow(templateName: keyof typeof windowTemplates): Promise<void> {
    const template = windowTemplates[templateName];

    if (template) {
        await createWindow(template);
    }
}

export function createSnapWindows(): void {
    // Create snap windows
    const colors = ['#7B7BFF', '#A7A7A7', '#3D4059', '#D8D8D8', '#1A194D', '#B6B6B6'];
    for (let i = 0; i < 6; i++) {
        fin.Window
            .create({
                url: `${launchDir}/testbed/index.html?theme=${colors[i % colors.length]}`,
                autoShow: true,
                defaultHeight: i > 2 ? 275 : 200,
                defaultWidth: i > 4 ? 400 : 300,
                defaultLeft: 350 * (i % 3) + 25,
                defaultTop: i > 2 ? 300 : 50,
                saveWindowState: false,
                frame: false,
                name: 'Window' + (i + 1)
            })
            .then(console.log, console.error);
    }
}

export async function setLayout(layoutParam?: Workspace) {
    const id = (document.getElementById('layoutName') as HTMLTextAreaElement).value;
    const layoutSelect = document.getElementById('layoutSelect') as HTMLSelectElement;
    const layout = layoutParam || await workspaces.generate();
    const workspace = {id, layout};

    if (layoutSelect) {
        let optionPresent = false;
        for (let idx = 0; idx < layoutSelect.options.length; idx++) {  // looping over the options
            if (layoutSelect.options[idx].value === id) {
                optionPresent = true;
                break;
            }
        }

        if (!optionPresent) {
            const option = createOptionElement(id);
            layoutSelect.appendChild(option);
        }
    }

    Storage.saveLayout(workspace);
    updateTextArea(layout);
}

export async function killAllWindows() {
    fin.desktop.System.getAllApplications((apps: fin.ApplicationInfo[]) => {
        apps.forEach((app) => {
            if (app.uuid !== 'layouts-service') {
                const wrappedApp = fin.desktop.Application.wrap(app.uuid);
                wrappedApp.getChildWindows((win) => {
                    win.forEach(w => w.close(true));
                });

                if (app.uuid !== 'Layouts-Manager') {
                    wrappedApp.close(true);
                }
            }
        });
    });
}

export async function getLayout() {
    const id = (document.getElementById('layoutSelect') as HTMLSelectElement).value;
    const workspace = Storage.getLayout(id);
    updateTextArea(workspace);
}

export async function getAllLayouts() {
    const layoutIDs = Storage.getAllLayoutIDs();
    updateTextArea(layoutIDs);
}

export async function restoreLayout() {
    const id = (document.getElementById('layoutSelect') as HTMLSelectElement).value;
    const workspace = Storage.getLayout(id);
    console.log('Restoring layout');
    const afterLayout = await workspaces.restore(workspace.layout);
    updateTextArea(afterLayout);
}

function updateTextArea(content: {}): void {
    const textArea = document.getElementById('showLayout') as HTMLTextAreaElement;
    textArea.value = JSON.stringify(content, null, 2);
}

function addLayoutNamesToDropdown() {
    const ids = Storage.getAllLayoutIDs();
    const layoutSelect = document.getElementById('layoutSelect');
    ids.forEach((id) => {
        const option = createOptionElement(id);
        if (layoutSelect) {
            layoutSelect.appendChild(option);
        }
    });
}

function createOptionElement(id: string) {
    const option = document.createElement('option');
    option.value = id;
    option.innerHTML = id;
    return option;
}

export function importLayout() {
    const textfield = document.getElementById('showLayout') as HTMLTextAreaElement;
    const layout = JSON.parse(textfield.value);
    setLayout(layout.layout || layout);
}

workspaces.ready();

fin.desktop.main(() => {
    addSpawnListeners();
    addLayoutNamesToDropdown();
});

// Expose layouts API and createApp/Window utils on window for debugging/demoing
Object.assign(window, {layouts: {register, deregister, snapAndDock, tabbing, tabstrip, workspaces}, createApp, createWindow});
