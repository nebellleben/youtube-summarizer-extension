// Options page script

document.addEventListener('DOMContentLoaded', async () => {
  // Get all elements
  const apiProviderSelect = document.getElementById('apiProvider');
  const anthropicKeyInput = document.getElementById('anthropicKey');
  const anthropicModelSelect = document.getElementById('anthropicModel');
  const glmKeyInput = document.getElementById('glmKey');
  const glmModelSelect = document.getElementById('glmModel');
  const autoOpenSidebarToggle = document.getElementById('autoOpenSidebar');
  const includeTimestampsToggle = document.getElementById('includeTimestamps');
  const summaryLanguageSelect = document.getElementById('summaryLanguage');
  const saveBtn = document.getElementById('saveBtn');
  const clearCacheBtn = document.getElementById('clearCacheBtn');
  const statusDiv = document.getElementById('status');

  const anthropicSettingsDiv = document.getElementById('anthropicSettings');
  const glmSettingsDiv = document.getElementById('glmSettings');

  // Load saved settings
  const settings = await chrome.storage.local.get([
    'apiProvider',
    'anthropicKey',
    'anthropicModel',
    'glmKey',
    'glmModel',
    'apiKey',  // legacy
    'model',   // legacy
    'autoOpenSidebar',
    'includeTimestamps',
    'summaryLanguage'
  ]);

  // Set API provider
  const provider = settings.apiProvider || 'anthropic';
  apiProviderSelect.value = provider;

  // Handle legacy keys - migrate to new format
  if (settings.apiKey && !settings.anthropicKey) {
    anthropicKeyInput.value = settings.apiKey;
  } else if (settings.anthropicKey) {
    anthropicKeyInput.value = settings.anthropicKey;
  }

  if (settings.model && !settings.anthropicModel) {
    anthropicModelSelect.value = settings.model;
  } else if (settings.anthropicModel) {
    anthropicModelSelect.value = settings.anthropicModel;
  }

  if (settings.glmKey) glmKeyInput.value = settings.glmKey;
  if (settings.glmModel) glmModelSelect.value = settings.glmModel;

  if (settings.autoOpenSidebar !== undefined) autoOpenSidebarToggle.checked = settings.autoOpenSidebar;
  if (settings.includeTimestamps !== undefined) includeTimestampsToggle.checked = settings.includeTimestamps;
  if (settings.summaryLanguage) summaryLanguageSelect.value = settings.summaryLanguage;

  // Show/hide settings based on provider
  function updateProviderSettings() {
    if (apiProviderSelect.value === 'glm') {
      anthropicSettingsDiv.style.display = 'none';
      glmSettingsDiv.style.display = 'block';
    } else {
      anthropicSettingsDiv.style.display = 'block';
      glmSettingsDiv.style.display = 'none';
    }
  }

  updateProviderSettings();

  // Provider change handler
  apiProviderSelect.addEventListener('change', () => {
    updateProviderSettings();
    // Auto-save provider selection
    chrome.storage.local.set({ apiProvider: apiProviderSelect.value });
  });

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
      apiProvider: apiProviderSelect.value,
      anthropicKey: anthropicKeyInput.value.trim(),
      anthropicModel: anthropicModelSelect.value,
      glmKey: glmKeyInput.value.trim(),
      glmModel: glmModelSelect.value,
      autoOpenSidebar: autoOpenSidebarToggle.checked,
      includeTimestamps: includeTimestampsToggle.checked,
      summaryLanguage: summaryLanguageSelect.value
    };

    // Validate that the selected provider has an API key
    if (apiProviderSelect.value === 'anthropic' && !settings.anthropicKey) {
      showStatus('Please enter your Anthropic API key', false);
      return;
    }
    if (apiProviderSelect.value === 'glm' && !settings.glmKey) {
      showStatus('Please enter your Zhipu AI API key', false);
      return;
    }

    await chrome.storage.local.set(settings);
    showStatus('Settings saved successfully!');
  });

  // Clear cache
  clearCacheBtn.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ action: 'clearCache' });
    showStatus('Cache cleared successfully!');
  });

  // Auto-save on change for other settings
  [autoOpenSidebarToggle, includeTimestampsToggle, summaryLanguageSelect, anthropicModelSelect, glmModelSelect].forEach(element => {
    element.addEventListener('change', async () => {
      const settings = {
        anthropicModel: anthropicModelSelect.value,
        glmModel: glmModelSelect.value,
        autoOpenSidebar: autoOpenSidebarToggle.checked,
        includeTimestamps: includeTimestampsToggle.checked,
        summaryLanguage: summaryLanguageSelect.value
      };
      await chrome.storage.local.set(settings);
    });
  });
});
