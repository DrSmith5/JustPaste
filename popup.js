let editingId = null;
let keywords = {};

// Load keywords on startup
chrome.storage.sync.get(['keywords'], (result) => {
    keywords = result.keywords || {};
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
        
        // Special handling for list commands
        if (cmd === 'insertUnorderedList' || cmd === 'insertOrderedList') {
            document.execCommand(cmd, false, null);
            // Ensure the button state reflects the current selection
            setTimeout(() => {
                const isActive = document.queryCommandState(cmd);
                btn.classList.toggle('active', isActive);
            }, 10);
        } else {
            document.execCommand(cmd, false, null);
            btn.classList.toggle('active', document.queryCommandState(cmd));
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
    
    form.classList.add('show');
    addBtn.textContent = keyword ? 'Cancel Edit' : 'Cancel';
    
    if (keyword) {
        editingId = keyword.id;
        document.getElementById('trigger').value = keyword.trigger;
        document.getElementById('editor').innerHTML = keyword.expansion;
        document.getElementById('saveBtn').textContent = 'Update Keyword';
    } else {
        editingId = null;
        document.getElementById('trigger').value = '';
        document.getElementById('editor').innerHTML = '';
        document.getElementById('saveBtn').textContent = 'Save Keyword';
    }
    
    document.getElementById('trigger').focus();
}

function hideForm() {
    const form = document.getElementById('keywordForm');
    const addBtn = document.getElementById('addBtn');
    
    form.classList.remove('show');
    addBtn.textContent = '+ Add New Keyword';
    editingId = null;
}

// Enhanced save function that properly preserves HTML formatting
function saveKeyword() {
    const trigger = document.getElementById('trigger').value.trim();
    const editor = document.getElementById('editor');
    
    // Get HTML content directly, don't convert to text
    let expansion = editor.innerHTML.trim();
    
    // Clean up the HTML but preserve essential formatting
    expansion = expansion
        .replace(/<div><br><\/div>/g, '<br>') // Clean up empty divs
        .replace(/<div>/g, '<br>') // Convert divs to line breaks
        .replace(/<\/div>/g, '') // Remove closing divs
        .replace(/^<br>/, '') // Remove leading breaks
        .replace(/<br>$/, ''); // Remove trailing breaks
    
    if (!trigger || !expansion) {
        alert('Please fill in both trigger and expansion fields.');
        return;
    }

    const id = editingId || Date.now().toString();
    const now = Date.now();
    
    // Handle creation vs update properly
    const existingKeyword = editingId ? keywords[id] : null;
    
    keywords[id] = {
        id,
        trigger: trigger.toLowerCase(),
        expansion, // Store raw HTML
        created: existingKeyword ? existingKeyword.created : now,
        updated: now
    };

    chrome.storage.sync.set({ keywords }, () => {
        console.log('Keywords saved:', keywords); // Debug log
        renderKeywords();
        updateStats();
        hideForm();
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
    if (confirm('Are you sure you want to delete this keyword?')) {
        delete keywords[id];
        chrome.storage.sync.set({ keywords }, () => {
            renderKeywords();
            updateStats();
        });
    }
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
                <div class="keyword-item">
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