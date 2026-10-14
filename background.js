const toggle = async () => {
  const { visible = true } = await chrome.storage.local.get('visible');
  await chrome.storage.local.set({ visible: !visible });
};
chrome.action.onClicked.addListener(toggle);
chrome.commands.onCommand.addListener(c => { if (c === 'toggle-meter') toggle(); });
