let editingId = null;
let keywords = {};
let triggerToId = {};
const errorBar = document.getElementById('formErrorBar');
const errorText = document.getElementById('formErrorText');
const errorClose = document.getElementById('formErrorClose');

errorClose.addEventListener('click', () => {
  errorBar.classList.add('hidden');
});


// Load keywords on startup
chrome.storage.local.get(['keywords'], (result) => {
    keywords = result.keywords || {};
    
    // BUILD triggerToId lookup
    triggerToId = {};
    for (const [id, keyword] of Object.entries(keywords)) {
        triggerToId[keyword.trigger] = id;
    }

    renderKeywords();
    updateStats();
});

// Add button click
document.getElementById('addBtn').addEventListener('click', () => {
    const form = document.getElementById('keywordForm');
    if (form.classList.contains('show')) {
        hideForm();
    } else {
        showForm();
    }
});

// Cancel button
document.getElementById('cancelBtn').addEventListener('click', () => {
    errorBar.classList.add('hidden');
    hideForm();
});

// Save button
document.getElementById('saveBtn').addEventListener('click', () => {
    saveKeyword();
});

// Enhanced toolbar button handling
document.querySelectorAll('.editor-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        const cmd = btn.dataset.cmd;
        document.execCommand(cmd, false, null);

        // Toggle 'active' only for text formatting (not list buttons)
        const toggleable = ['bold', 'italic', 'underline'];
        if (toggleable.includes(cmd)) {
            btn.classList.toggle('active', document.queryCommandState(cmd));
        } else {
            btn.classList.remove('active');
        }

        document.getElementById('editor').focus();
    });
});


// Search functionality
document.getElementById('searchBox').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    renderKeywords(query);
});

function showForm(keyword = null) {
    const form = document.getElementById('keywordForm');
    const addBtn = document.getElementById('addBtn');
    document.body.style.overflow = 'auto';
    
    form.classList.add('show');
    addBtn.textContent = keyword ? 'Cancel Edit' : 'Cancel';
    
    const editorEl = document.getElementById('editor');

    if (keyword) {
        editingId = keyword.id;
        document.getElementById('trigger').value = keyword.trigger;
        editorEl.innerHTML = keyword.expansion;
        editorEl.dataset.lastContent = keyword.expansion; // ensure it doesn't restore old content on blur
        document.getElementById('saveBtn').textContent = 'Update Keyword';
    } else {
        editingId = null;
        document.getElementById('trigger').value = '';
        editorEl.innerHTML = '';
        editorEl.dataset.lastContent = ''; // prevent re-inserting old data
        document.getElementById('saveBtn').textContent = 'Save Keyword';
    }

    
    document.getElementById('trigger').focus();
}

function hideForm() {
    const form = document.getElementById('keywordForm');
    const addBtn = document.getElementById('addBtn');
    document.body.style.overflow = 'hidden';

    errorBar.classList.add('hidden');
    
    form.classList.remove('show');
    addBtn.textContent = '+ Add New Keyword';
    editingId = null;
}

// Enhanced save function that properly preserves HTML formatting
// Enhanced save function with proper duplicate error handling
function saveKeyword() {
    const trigger = document.getElementById('trigger').value.trim();
    const editor = document.getElementById('editor');
    let expansion = editor.innerHTML.trim();

    // Clean up expansion
    expansion = expansion
        .replace(/<div><br><\/div>/g, '<br>')
        .replace(/<div>/g, '<br>')
        .replace(/<\/div>/g, '')
        .replace(/^<br>/, '')
        .replace(/<br>$/, '');

    // Hide error if shown
    errorBar.classList.add('hidden');

    if (!trigger || !expansion) return;

    if (trigger.includes(' ')) {
        showErrorWithFade('Spaces are not allowed in the keyword.');
        return;
    }

    const normalizedTrigger = trigger.toLowerCase();
    
    // O(1) duplicate check using triggerToId
    const existingId = triggerToId[normalizedTrigger];
    const existingKeyword = existingId && existingId !== editingId ? keywords[existingId] : null;

    if (existingKeyword) {
        showErrorWithFade(`The keyword "${trigger}" already exists.`);
        return;
    }

    // Create/update keyword
    const id = editingId || Date.now().toString();
    const now = Date.now();
    const currentKeyword = editingId ? keywords[id] : null;

    keywords[id] = {
        id,
        trigger: normalizedTrigger,
        expansion,
        created: currentKeyword ? currentKeyword.created : now,
        updated: now
    };

    // Add to triggerToId
    triggerToId[normalizedTrigger] = id;

    chrome.storage.local.set({ keywords }, () => {
        renderKeywords();
        updateStats();
        hideForm();
        errorBar.classList.add('hidden'); // clear on success
    });
}


// Update the editor to handle paste events properly
document.addEventListener('DOMContentLoaded', function() {
    const editor = document.getElementById('editor');
    
    // Handle paste to preserve formatting
    editor.addEventListener('paste', function(e) {
        e.preventDefault();
        
        // Get pasted content
        const paste = (e.clipboardData || window.clipboardData).getData('text/html') || 
                     (e.clipboardData || window.clipboardData).getData('text/plain');
        
        // Insert at cursor position
        document.execCommand('insertHTML', false, paste);
    });
    
    // Prevent the editor from losing formatting on blur/focus
    editor.addEventListener('blur', function() {
        // Store current content to prevent loss
        this.dataset.lastContent = this.innerHTML;
    });
    
    editor.addEventListener('focus', function() {
        // Restore content if it was somehow lost
        if (this.innerHTML === '' && this.dataset.lastContent) {
            this.innerHTML = this.dataset.lastContent;
        }
    });

    // Add horizontal scroll handling
    editor.addEventListener('keydown', function(e) {
        // Enable horizontal scrolling with arrow keys when text is wide
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                setTimeout(() => {
                    // Scroll the element horizontally to keep cursor visible
                    const rect = range.getBoundingClientRect();
                    const editorRect = editor.getBoundingClientRect();
                    
                    if (rect.left < editorRect.left) {
                        editor.scrollLeft -= (editorRect.left - rect.left + 20);
                    } else if (rect.right > editorRect.right) {
                        editor.scrollLeft += (rect.right - editorRect.right + 20);
                    }
                }, 0);
            }
        }
    });
});

function deleteKeyword(id) {
    const keywordEl = document.querySelector(`.action-btn.delete[data-id="${id}"]`).closest('.keyword-item');

    // Prevent duplicates
    if (keywordEl.querySelector('.confirm-delete')) return;

    // Create confirm bar
    const confirmBar = document.createElement('div');
    confirmBar.className = 'confirm-delete';
    confirmBar.innerHTML = `
        <span class="confirm-text">Delete this keyword?</span>
        <div class="confirm-actions">
            <button class="btn-confirm">Yes</button>
            <button class="btn-cancel">No</button>
        </div>
    `;

    keywordEl.appendChild(confirmBar);

    confirmBar.querySelector('.btn-confirm').addEventListener('click', () => {
        const keyword = keywords[id];

        delete keywords[id];
        delete triggerToId[keyword.trigger];
        
        chrome.storage.local.set({ keywords }, () => {
            renderKeywords();
            updateStats();
        });
    });

    confirmBar.querySelector('.btn-cancel').addEventListener('click', () => {
        confirmBar.remove();
    });
}


function editKeyword(id) {
    const keyword = keywords[id];
    showForm(keyword);
}

function renderKeywords(searchQuery = '') {
    const container = document.getElementById('keywordsList');
    const searchBox = document.getElementById('searchBox');
    
    const filteredKeywords = Object.values(keywords).filter(keyword => 
        keyword.trigger.includes(searchQuery) || 
        keyword.expansion.toLowerCase().includes(searchQuery)
    );

    if (Object.keys(keywords).length === 0) {
        searchBox.classList.add('hidden');
        container.innerHTML = `
            <div class="empty-state">
                <div style="font-size: 48px; margin-bottom: 15px;">📝</div>
                <h3>No keywords yet</h3>
                <p>Create your first keyword shortcut to get started!</p>
            </div>
        `;
        return;
    }

    searchBox.classList.remove('hidden');

    if (filteredKeywords.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div style="font-size: 48px; margin-bottom: 15px;">🔍</div>
                <h3>No keywords found</h3>
                <p>Try a different search term.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = filteredKeywords
        .sort((a, b) => b.updated - a.updated)
        .map(keyword => {
            const preview = keyword.expansion.replace(/<[^>]*>/g, '').substring(0, 100);
            return `
                <div class="keyword-item dark-compatible">
                    <div class="keyword-header">
                        <span class="keyword-trigger">${keyword.trigger}</span>
                        <div class="keyword-actions">
                            <button class="action-btn edit" data-id="${keyword.id}" title="Edit">✏️</button>
                            <button class="action-btn delete" data-id="${keyword.id}" title="Delete">🗑️</button>
                        </div>
                    </div>
                    <div class="keyword-preview">${preview}${preview.length === 100 ? '...' : ''}</div>
                </div>
            `;
        }).join('');
    
    // Add event listeners for edit and delete buttons
    container.querySelectorAll('.action-btn.edit').forEach(btn => {
        btn.addEventListener('click', () => {
            editKeyword(btn.dataset.id);
        });
    });
    
    container.querySelectorAll('.action-btn.delete').forEach(btn => {
        btn.addEventListener('click', () => {
            deleteKeyword(btn.dataset.id);
        });
    });
}

function updateStats() {
    const count = Object.keys(keywords).length;
    document.getElementById('stats').textContent = `${count} keyword${count !== 1 ? 's' : ''} saved`;
}

document.addEventListener('DOMContentLoaded', () => {
  const versionElem = document.getElementById('version');
  const manifestData = chrome.runtime.getManifest();
  versionElem.textContent = `v${manifestData.version}`;
});

document.addEventListener('DOMContentLoaded', () => {
  const settingsBtn = document.getElementById('settingsButton');
  const settingsPanel = document.getElementById('settingsPanel');
  const settingsOverlay = document.getElementById('settingsOverlay');
  const toggle = document.getElementById('darkModeToggle');

  // Load saved theme
  const isDark = localStorage.getItem('darkMode') === 'true';
  document.body.classList.toggle('dark-mode', isDark);
  toggle.checked = isDark;

  // Toggle panel + overlay
  function toggleSettings() {
    const isOpen = settingsPanel.classList.contains('open');
    settingsPanel.classList.toggle('open', !isOpen);
    settingsOverlay.classList.toggle('visible', !isOpen);
  }

  settingsBtn.addEventListener('click', toggleSettings);
  settingsOverlay.addEventListener('click', toggleSettings);

  // Toggle dark mode
  toggle.addEventListener('change', () => {
    const enabled = toggle.checked;
    document.body.classList.toggle('dark-mode', enabled);
    localStorage.setItem('darkMode', enabled);
  });
});

// Add expand button functionality
document.getElementById('expandBtn').addEventListener('click', () => {
    const editor = document.getElementById('editor');
    const editorContainer = document.getElementById('editor').closest('.editor-container');
    const expandBtn = document.getElementById('expandBtn');
    
    if (editor.classList.contains('expanded')) {
        // Collapse
        editor.classList.remove('expanded');
        editorContainer.style.position = '';
        editorContainer.style.top = '';
        editorContainer.style.left = '';
        editorContainer.style.width = '';
        editorContainer.style.height = '';
        editorContainer.style.zIndex = '';
        editorContainer.style.boxShadow = '';
        editor.style.height = '';
        editor.style.minHeight = '';
        editor.style.maxHeight = '';
        expandBtn.innerHTML = '⤢';
        expandBtn.title = 'Expand editor';
    } else {
        // Expand - move the entire editor container
        editor.classList.add('expanded');
        editorContainer.style.position = 'fixed';
        editorContainer.style.top = '20px';
        editorContainer.style.left = '20px';
        editorContainer.style.width = 'calc(100vw - 40px)';
        editorContainer.style.height = 'calc(100vh - 40px)';
        editorContainer.style.zIndex = '9999';
        editorContainer.style.boxShadow = '0 20px 50px rgba(0,0,0,0.5)';
        editor.style.height = 'calc(100vh - 100px)';
        editor.style.minHeight = 'calc(100vh - 100px)';
        editor.style.maxHeight = 'calc(100vh - 100px)';
        expandBtn.innerHTML = '⤡';
        expandBtn.title = 'Collapse editor';
    }
});

function showErrorWithFade(message) {
    errorText.textContent = message;
    errorBar.classList.remove('hidden');
    errorBar.classList.remove('fade-out'); // Make sure it's visible
    
    setTimeout(() => {
        errorBar.classList.add('fade-out'); // Start fade
        
        // Hide completely after fade finishes
        setTimeout(() => {
            errorBar.classList.add('hidden');
            errorBar.classList.remove('fade-out'); // Reset for next time
        }, 300); // 300ms matches the CSS transition
    }, 2700); // Start fade at 2.7s (total 3s)
}

