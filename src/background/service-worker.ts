chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Crith] service worker installed:', details.reason)
})

chrome.runtime.onStartup.addListener(() => {
  console.log('[Crith] service worker startup')
})
