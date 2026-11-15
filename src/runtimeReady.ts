let ready: Promise<void> | undefined;
export function ensureBrowserRuntime() {
  return ready ||= import('./browserRuntime').then(module => module.installBrowserRuntime()).catch(error => {
    ready = undefined;
    throw error;
  });
}
