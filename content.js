// Enhanced content script for keyword expansion - works with ticketing systems
let keywords = {};
let currentPopup = null;
let currentTarget = null;
let isExpanding = false;
let observer = null;

// Load keywords from storage
chrome.storage.sync.get(['keywords'], (result) => {
    keywords = result.keywords || {};
});

// Listen for storage changes
chrome.storage.onChanged.addListener((changes) => {
    if (changes.keywords) {
        keywords = changes.keywords.newValue || {};
    }
});

// Enhanced element detection for various input types
function isTextInput(element) {
    if (!element) return false;
    
    const tagName = element.tagName.toLowerCase();
    const type = (element.type || '').toLowerCase();
    const role = element.getAttribute('role') || '';
    const contentEditable = element.contentEditable;
    
    return (
        // Standard inputs
        (tagName === 'input' && ['text', 'email', 'search', 'url', 'tel', ''].includes(type)) ||
        tagName === 'textarea' ||
        
        // ContentEditable elements
        contentEditable === 'true' ||
        contentEditable === '' ||
        
        // ARIA roles
        role === 'textbox' ||
        
        // Common ticketing system patterns
        element.classList.contains('editor') ||
        element.classList.contains('text-input') ||
        element.classList.contains('comment') ||
        element.classList.contains('description') ||
        element.classList.contains('note') ||
        element.classList.contains('reply') ||
        element.classList.contains('message') ||
        
        // Rich text editors
        element.closest('.ql-editor') || // Quill
        element.closest('.DraftEditor-root') || // Draft.js
        element.closest('.fr-element') || // FroalaEditor
        element.closest('.note-editable') || // Summernote
        element.closest('.cke_editable') || // CKEditor
        element.closest('.mce-content-body') || // TinyMCE
        element.closest('[data-slate-editor]') || // Slate
        element.closest('.prosemirror-editor') || // ProseMirror
        
        // Framework-specific patterns
        element.closest('[data-testid*="input"]') ||
        element.closest('[data-testid*="text"]') ||
        element.closest('[data-testid*="comment"]') ||
        element.closest('[data-testid*="editor"]')
    );
}

// Create popup element
function createPopup() {
    const popup = document.createElement('div');
    popup.className = 'keyword-expander-popup';
    popup.style.cssText = `
        position: fixed;
        background: white;
        border: 1px solid #e1e5e9;
        border-radius: 8px;
        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
        padding: 0;
        z-index: 2147483647;
        max-width: 300px;
        opacity: 0;
        transform: translateY(-10px) scale(0.95);
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        pointer-events: none;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
    `;
    document.body.appendChild(popup);
    return popup;
}

// Show popup with animation
function showPopup(popup) {
    popup.style.pointerEvents = 'auto';
    requestAnimationFrame(() => {
        popup.style.opacity = '1';
        popup.style.transform = 'translateY(0) scale(1)';
    });
}

// Hide popup with animation
function hidePopup(popup) {
    if (popup && popup.parentNode) {
        popup.style.opacity = '0';
        popup.style.transform = 'translateY(-10px) scale(0.95)';
        popup.style.pointerEvents = 'none';
        setTimeout(() => {
            if (popup.parentNode) {
                popup.parentNode.removeChild(popup);
            }
        }, 200);
    }
}

// Enhanced text extraction that works with various editors
function getElementText(element) {
    // For standard inputs
    if (element.value !== undefined) {
        return element.value;
    }
    
    // For contentEditable - try different methods
    if (element.textContent !== undefined) {
        return element.textContent;
    }
    
    if (element.innerText !== undefined) {
        return element.innerText;
    }
    
    return '';
}

// Enhanced cursor position detection
function getCursorPosition(element) {
    try {
        // Standard inputs
        if (element.selectionStart !== undefined) {
            return element.selectionStart;
        }
        
        // ContentEditable elements
        const selection = window.getSelection();
        if (selection.rangeCount === 0) return 0;
        
        const range = selection.getRangeAt(0);
        const preCaretRange = range.cloneRange();
        preCaretRange.selectNodeContents(element);
        preCaretRange.setEnd(range.endContainer, range.endOffset);
        
        return preCaretRange.toString().length;
    } catch (e) {
        return 0;
    }
}

// Set cursor position
function setCursorPosition(element, position) {
    try {
        if (element.setSelectionRange) {
            element.setSelectionRange(position, position);
        } else if (element.createTextRange) {
            const range = element.createTextRange();
            range.move('character', position);
            range.select();
        } else {
            // ContentEditable
            const selection = window.getSelection();
            const range = document.createRange();
            
            const walker = document.createTreeWalker(
                element,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );
            
            let currentPos = 0;
            let targetNode = null;
            let targetOffset = 0;
            
            while (walker.nextNode()) {
                const node = walker.currentNode;
                const nodeLength = node.textContent.length;
                
                if (currentPos + nodeLength >= position) {
                    targetNode = node;
                    targetOffset = position - currentPos;
                    break;
                }
                currentPos += nodeLength;
            }
            
            if (targetNode) {
                range.setStart(targetNode, targetOffset);
                range.setEnd(targetNode, targetOffset);
                selection.removeAllRanges();
                selection.addRange(range);
            }
        }
    } catch (e) {
        console.warn('Could not set cursor position:', e);
    }
}

// Get current word and position
function getCurrentWord(element) {
    const text = getElementText(element);
    const caretPos = getCursorPosition(element);
    
    let start = caretPos;
    let end = caretPos;
    
    // Find word boundaries
    while (start > 0 && !/\s/.test(text[start - 1])) {
        start--;
    }
    
    while (end < text.length && !/\s/.test(text[end])) {
        end++;
    }
    
    const word = text.substring(start, end);
    return { word: word.toLowerCase(), start, end };
}

// Enhanced HTML to plain text conversion
function htmlToText(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    
    // Convert lists to plain text with proper formatting
    div.querySelectorAll('ul').forEach(list => {
        const items = list.querySelectorAll('li');
        let listText = '\n';
        items.forEach(item => {
            listText += '• ' + (item.textContent || item.innerText) + '\n';
        });
        list.replaceWith(document.createTextNode(listText));
    });
    
    div.querySelectorAll('ol').forEach(list => {
        const items = list.querySelectorAll('li');
        let listText = '\n';
        items.forEach((item, index) => {
            listText += `${index + 1}. ` + (item.textContent || item.innerText) + '\n';
        });
        list.replaceWith(document.createTextNode(listText));
    });
    
    // Convert other elements
    div.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    div.querySelectorAll('p').forEach(p => {
        p.insertAdjacentText('afterend', '\n');
    });
    div.querySelectorAll('div').forEach(div => {
        div.insertAdjacentText('afterend', '\n');
    });
    
    return (div.textContent || div.innerText || '').replace(/\n\s*\n/g, '\n').trim();
}

// Enhanced expansion that works with various input types
function expandKeyword(element, expansion, wordInfo) {
    try {
        const plainText = htmlToText(expansion);
        
        // For standard inputs
        if (element.value !== undefined) {
            const value = element.value;
            const before = value.substring(0, wordInfo.start);
            const after = value.substring(wordInfo.end);
            
            element.value = before + plainText + after;
            
            const newCaretPos = before.length + plainText.length;
            setCursorPosition(element, newCaretPos);
            
            // Trigger events
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            return;
        }
        
        // For contentEditable elements
        const selection = window.getSelection();
        if (selection.rangeCount === 0) return;
        
        const range = selection.getRangeAt(0);
        const text = getElementText(element);
        
        // Find the text node containing our word
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );
        
        let currentPos = 0;
        let textNode = null;
        let nodeStartPos = 0;
        
        while (walker.nextNode()) {
            const node = walker.currentNode;
            const nodeLength = node.textContent.length;
            
            if (currentPos + nodeLength >= wordInfo.start) {
                textNode = node;
                nodeStartPos = currentPos;
                break;
            }
            currentPos += nodeLength;
        }
        
        if (textNode) {
            const nodeStart = wordInfo.start - nodeStartPos;
            const nodeEnd = wordInfo.end - nodeStartPos;
            
            // Create range for the word
            const wordRange = document.createRange();
            wordRange.setStart(textNode, nodeStart);
            wordRange.setEnd(textNode, Math.min(nodeEnd, textNode.textContent.length));
            
            // Delete the word
            wordRange.deleteContents();
            
            // Insert HTML or plain text based on element capabilities
            if (element.innerHTML !== undefined) {
                // Rich text editor - insert HTML
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = expansion;
                
                const fragment = document.createDocumentFragment();
                while (tempDiv.firstChild) {
                    fragment.appendChild(tempDiv.firstChild);
                }
                
                wordRange.insertNode(fragment);
            } else {
                // Plain text editor
                wordRange.insertNode(document.createTextNode(plainText));
            }
            
            // Position cursor at end
            wordRange.collapse(false);
            selection.removeAllRanges();
            selection.addRange(wordRange);
        }
        
        // Trigger events
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        
    } catch (e) {
        console.warn('Expansion failed:', e);
    }
}

// Position popup
function positionPopup(popup, element, wordInfo) {
    let rect;

    if (element.contentEditable === 'true' || element.isContentEditable) {
        const selection = window.getSelection();
        if (!selection.rangeCount) return;

        if (!selection.rangeCount || !wordInfo || !wordInfo.word) return;

        const range = selection.getRangeAt(0).cloneRange();
        range.setStart(range.endContainer, range.endOffset - wordInfo.word.length);
        range.setEnd(range.endContainer, range.endOffset);

        rect = range.getBoundingClientRect();
    } else {
        // Fallback to element box for inputs
        rect = element.getBoundingClientRect();
    }

    // Get popup dimensions
    popup.style.visibility = 'hidden';
    popup.style.display = 'block';
    const popupRect = popup.getBoundingClientRect();
    popup.style.visibility = 'visible';

    let top = rect.top - popupRect.height - 8;
    if (top < 0) top = rect.bottom + 8;

    let left = rect.left;
    if (left + popupRect.width > window.innerWidth) {
        left = window.innerWidth - popupRect.width - 10;
    }
    if (left < 10) left = 10;

    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
}


// Enhanced input handler with debouncing
let inputTimeout = null;
function handleInput(event) {
    if (isExpanding) return;
    
    clearTimeout(inputTimeout);
    inputTimeout = setTimeout(() => {
        processInput(event);
    }, 100);
}

function processInput(event) {
    const element = event.target;
    
    if (!isTextInput(element)) return;
    
    // Remove existing popup
    if (currentPopup) {
        hidePopup(currentPopup);
        currentPopup = null;
    }
    
    const wordInfo = getCurrentWord(element);
    
    if (!wordInfo || wordInfo.word.length < 1) return;
    
    // Check for matching keywords
    const matchingKeywords = Object.values(keywords).filter(k => 
        k.trigger === wordInfo.word
    );
    
    if (matchingKeywords.length === 0) return;
    
    // Create and show popup
    currentPopup = createPopup();
    currentTarget = element;
    
    matchingKeywords.forEach((keyword, index) => {
        const item = document.createElement('div');
        item.style.cssText = `
            padding: 12px 16px;
            cursor: pointer;
            border-bottom: ${index < matchingKeywords.length - 1 ? '1px solid #f0f0f0' : 'none'};
            transition: background-color 0.15s ease;
            font-size: 14px;
            line-height: 1.4;
        `;
        
        const preview = htmlToText(keyword.expansion).substring(0, 100);
        item.innerHTML = `
            <div style="font-weight: 600; color: #333; margin-bottom: 4px;">
                ${keyword.trigger}
            </div>
            <div style="color: #666; font-size: 12px;">
                ${preview}${preview.length === 100 ? '...' : ''}
            </div>
        `;
        
        item.addEventListener('mouseenter', () => {
            item.style.backgroundColor = '#f8f9fa';
        });
        
        item.addEventListener('mouseleave', () => {
            item.style.backgroundColor = 'transparent';
        });
        
        item.addEventListener('click', () => {
            isExpanding = true;
            expandKeyword(element, keyword.expansion, wordInfo);
            hidePopup(currentPopup);
            currentPopup = null;
            currentTarget = null;
            
            setTimeout(() => {
                isExpanding = false;
            }, 100);
        });
        
        currentPopup.appendChild(item);
    });
    
    positionPopup(currentPopup, element, wordInfo);
    showPopup(currentPopup);
}

// Handle clicks outside popup
function handleClickOutside(event) {
    if (currentPopup && !currentPopup.contains(event.target) && event.target !== currentTarget) {
        hidePopup(currentPopup);
        currentPopup = null;
        currentTarget = null;
    }
}

// Handle escape key
function handleKeyDown(event) {
    if (event.key === 'Escape' && currentPopup) {
        hidePopup(currentPopup);
        currentPopup = null;
        currentTarget = null;
    }
}

// Set up mutation observer for dynamic content
function setupObserver() {
    if (observer) observer.disconnect();
    
    observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // Check if new elements are text inputs
                    if (isTextInput(node)) {
                        attachListeners(node);
                    }
                    
                    // Check descendants
                    const inputs = node.querySelectorAll('input, textarea, [contenteditable], [role="textbox"]');
                    inputs.forEach(attachListeners);
                }
            });
        });
    });
    
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

// Attach listeners to specific element
function attachListeners(element) {
    if (element._keywordExpanderAttached) return;
    element._keywordExpanderAttached = true;
    
    element.addEventListener('input', handleInput, { passive: true });
}

// Initialize
function initialize() {
    // Add event listeners
    document.addEventListener('click', handleClickOutside, true);
    document.addEventListener('keydown', handleKeyDown, true);
    
    // Handle window events
    window.addEventListener('resize', () => {
        if (currentPopup && currentTarget) {
            positionPopup(currentPopup, currentTarget);
        }
    });
    
    window.addEventListener('scroll', () => {
        if (currentPopup && currentTarget) {
            positionPopup(currentPopup, currentTarget);
        }
    }, true);
    
    // Attach to existing elements
    const existingInputs = document.querySelectorAll('input, textarea, [contenteditable], [role="textbox"]');
    existingInputs.forEach(attachListeners);
    
    // Set up observer for dynamic content
    setupObserver();
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

// Handle page navigation (for SPAs)
let currentUrl = location.href;
new MutationObserver(() => {
    if (location.href !== currentUrl) {
        currentUrl = location.href;
        setTimeout(initialize, 1000); // Delay for content to load
    }
}).observe(document, { subtree: true, childList: true });