chrome.action.onClicked.addListener(tab => {
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { action: 'toggle' }).catch(() => {});
});
chrome.commands.onCommand.addListener(async c => {
  if (c === 'toggle-meter') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { action: 'toggle' }).catch(() => {});
  }
});
