// Options page script

document.addEventListener('DOMContentLoaded', async () => {
  const apiKeyInput = document.getElementById('apiKey');
  const modelSelect = document.getElementById('model');
  const autoOpenSidebarToggle = document.getElementById('autoOpenSidebar');
  const includeTimestampsToggle = document.getElementById('includeTimestamps');
  const summaryLanguageSelect = document.getElementById('summaryLanguage');
  const saveBtn = document.getElementById('saveBtn');
  const clearCacheBtn = document.getElementById('clearCacheBtn');
  const statusDiv = document.getElementById('status');

  // Load saved settings
  const settings = await chrome.storage.local.get([
    'apiKey',
    'model',
    'autoOpenSidebar',
    'includeTimestamps',
    'summaryLanguage'
  ]);

  if (settings.apiKey) apiKeyInput.value = settings.apiKey;
  if (settings.model) modelSelect.value = settings.model;
  if (settings.autoOpenSidebar !== undefined) autoOpenSidebarToggle.checked = settings.autoOpenSidebar;
  if (settings.includeTimestamps !== undefined) includeTimestampsToggle.checked = settings.includeTimestamps;
  if (settings.summaryLanguage) summaryLanguageSelect.value = settings.summaryLanguage;

  // Show status message
  function showStatus(message, isSuccess = true) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${isSuccess ? 'status-success' : 'status-error'} show`;
    setTimeout(() => {
      statusDiv.classList.remove('show');
    }, 3000);
  }

  // Save settings
  saveBtn.addEventListener('click', async () => {
    const settings = {
      apiKey: apiKeyInput.value.trim(),
      model: modelSelect.value,
      autoOpenSidebar: autoOpenSidebarToggle.checked,
      includeTimestamps: includeTimestampsToggle.checked,
      summaryLanguage: summaryLanguageSelect.value
    };

    await chrome.storage.local.set(settings);
    showStatus('Settings saved successfully!');
  });

  // Clear cache
  clearCacheBtn.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ action: 'clearCache' });
    showStatus('Cache cleared successfully!');
  });

  // Auto-save on change for toggles
  [autoOpenSidebarToggle, includeTimestampsToggle, summaryLanguageSelect, modelSelect].forEach(element => {
    element.addEventListener('change', async () => {
      const settings = {
        model: modelSelect.value,
        autoOpenSidebar: autoOpenSidebarToggle.checked,
        includeTimestamps: includeTimestampsToggle.checked,
        summaryLanguage: summaryLanguageSelect.value
      };
      await chrome.storage.local.set(settings);
    });
  });
});
