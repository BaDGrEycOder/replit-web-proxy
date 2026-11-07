(function () {
  const STORAGE_KEY = 'privateProxy.customBackground';
  const MAX_FILE_SIZE = 3 * 1024 * 1024;
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
  const chooseButton = document.getElementById('chooseBackground');
  const resetButton = document.getElementById('resetBackground');
  const fileInput = document.getElementById('backgroundFile');
  const status = document.getElementById('backgroundStatus');

  function applyBackground(dataUrl) {
    document.body.style.setProperty('--user-background', `url("${dataUrl}")`);
    document.body.classList.add('has-user-background');
    resetButton.hidden = false;
  }

  try {
    const savedBackground = localStorage.getItem(STORAGE_KEY);
    if (savedBackground && savedBackground.startsWith('data:image/')) applyBackground(savedBackground);
  } catch {
    status.textContent = 'Browser storage is unavailable; background changes will not persist.';
  }

  chooseButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    if (!allowedTypes.has(file.type)) {
      status.textContent = 'Choose a JPEG, PNG, WebP, or GIF image.';
      fileInput.value = '';
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      status.textContent = 'That image is too large. Choose an image smaller than 3 MB.';
      fileInput.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => { status.textContent = 'The image could not be read. Please try another file.'; };
    reader.onload = () => {
      const dataUrl = reader.result;
      try {
        localStorage.setItem(STORAGE_KEY, dataUrl);
        applyBackground(dataUrl);
        status.textContent = 'Background updated. It is saved in this browser on this device.';
      } catch {
        status.textContent = 'Could not save this image in browser storage. Try a smaller image or clear some site data.';
      }
      fileInput.value = '';
    };
    reader.readAsDataURL(file);
  });

  resetButton.addEventListener('click', () => {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* Reset the visible background even if storage is unavailable. */ }
    document.body.style.removeProperty('--user-background');
    document.body.classList.remove('has-user-background');
    resetButton.hidden = true;
    status.textContent = 'Restored the default rainforest background.';
  });
})();
