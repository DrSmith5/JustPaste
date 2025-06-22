// Content script for keyword expansion
let keywords = {};
let currentPopup = null;
let currentTarget = null;
let isExpanding = false;

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

// Create popup element
function createPopup() {
    const popup = document.createElement('div');
    popup.className = 'keyword-expander-popup';
    popup.style.cssText = `
        position: absolute;
        background: white;
        border: 1px solid #e1e5e9;
        border-radius: 8px;
        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
        padding: 0;
        z-index: 10000;
        max-width: 300px;
        opacity: 0;
        transform: translateY(-10px) scale(0.95);
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        pointer-events: none;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
    document.body.appendChild(popup);
    return popup;
}

// Show popup with animation
function showPopup(popup) {
    popup.style.pointerEvents = 'auto';
    // Trigger reflow
    popup.offsetHeight;
    popup.style.opacity = '1';
    popup.style.transform = 'translateY(0) scale(1)';
}

// Hide popup with animation
function hidePopup(popup) {
    if (popup) {
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

// Get caret position in input/textarea
function getCaretPosition(element) {
    return element.selectionStart;
}

// Set caret position in input/textarea
function setCaretPosition(element, position) {
    element.selectionStart = element.selectionEnd = position;
}

// Get current word and its position
function getCurrentWord(element) {
    const value = element.value;
    const caretPos = getCaretPosition(element);
    
    // Find word boundaries
    let start = caretPos;
    let end = caretPos;
    
    // Find start of word (go backwards until space or start)
    while (start > 0 && !/\s/.test(value[start - 1])) {
        start--;
    }
    
    // Find end of word (go forwards until space or end)
    while (end < value.length && !/\s/.test(value[end])) {
        end++;
    }
    
    const word = value.substring(start, end);
    return { word: word.toLowerCase(), start, end };
}

// Convert HTML to plain text for input fields
function htmlToText(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    
    // Handle lists
    div.querySelectorAll('ul, ol').forEach(list => {
        const items = list.querySelectorAll('li');
        items.forEach((item, index) => {
            const prefix = list.tagName === 'UL' ? '• ' : `${index + 1}. `;
            item.textContent = prefix + item.textContent;
        });
    });
    
    // Handle line breaks
    div.querySelectorAll('br').forEach(br => {
        br.replaceWith('\n');
    });
    
    // Handle paragraphs
    div.querySelectorAll('p').forEach(p => {
        p.insertAdjacentText('afterend', '\n');
    });
    
    return div.textContent || div.innerText || '';
}

// Expand keyword in input/textarea
function expandKeyword(element, expansion, wordInfo) {
    const value = element.value;
    const plainText = htmlToText(expansion);
    
    const before = value.substring(0, wordInfo.start);
    const after = value.substring(wordInfo.end);
    
    element.value = before + plainText + after;
    
    // Set cursor position after expansion
    const newCaretPos = before.length + plainText.length;
    setCaretPosition(element, newCaretPos);
    
    // Trigger input event
    element.dispatchEvent(new Event('input', { bubbles: true }));
}

// Expand keyword in contentEditable
function expandKeywordInContentEditable(element, expansion, wordInfo) {
    const selection = window.getSelection();
    const range = document.createRange();
    
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
        range.setStart(textNode, nodeStart);
        range.setEnd(textNode, nodeEnd);
        
        // Delete the word
        range.deleteContents();
        
        // Insert the expansion
        const div = document.createElement('div');
        div.innerHTML = expansion;
        const fragment = document.createDocumentFragment();
        
        while (div.firstChild) {
            fragment.appendChild(div.firstChild);
        }
        
        range.insertNode(fragment);
        
        // Position cursor at end of insertion
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }
}

// Get text content from contentEditable
function getContentEditableText(element) {
    return element.textContent || '';
}

// Get word info for contentEditable
function getContentEditableWordInfo(element) {
    const selection = window.getSelection();
    if (selection.rangeCount === 0) return null;
    
    const range = selection.getRangeAt(0);
    const textContent = getContentEditableText(element);
    
    // Get cursor position in text
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(element);
    preCaretRange.setEnd(range.endContainer, range.endOffset);
    const caretPos = preCaretRange.toString().length;
    
    // Find word boundaries
    let start = caretPos;
    let end = caretPos;
    
    while (start > 0 && !/\s/.test(textContent[start - 1])) {
        start--;
    }
    
    while (end < textContent.length && !/\s/.test(textContent[end])) {
        end++;
    }
    
    const word = textContent.substring(start, end);
    return { word: word.toLowerCase(), start, end };
}

// Position popup near cursor
function positionPopup(popup, element) {
    const rect = element.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
    
    let top = rect.bottom + scrollTop + 5;
    let left = rect.left + scrollLeft;
    
    // Adjust if popup would go off-screen
    const popupRect = popup.getBoundingClientRect();
    if (left + popupRect.width > window.innerWidth) {
        left = window.innerWidth - popupRect.width - 10;
    }
    
    if (top + popupRect.height > window.innerHeight + scrollTop) {
        top = rect.top + scrollTop - popupRect.height - 5;
    }
    
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
}

// Handle input events
function handleInput(event) {
    if (isExpanding) return;
    
    const element = event.target;
    const isInput = element.tagName === 'INPUT' && element.type === 'text';
    const isTextarea = element.tagName === 'TEXTAREA';
    const isContentEditable = element.contentEditable === 'true';
    
    if (!isInput && !isTextarea && !isContentEditable) return;
    
    // Remove existing popup
    if (currentPopup) {
        hidePopup(currentPopup);
        currentPopup = null;
    }
    
    let wordInfo;
    if (isContentEditable) {
        wordInfo = getContentEditableWordInfo(element);
    } else {
        wordInfo = getCurrentWord(element);
    }
    
    if (!wordInfo || wordInfo.word.length < 2) return;
    
    // Check if word matches any keyword
    const matchingKeywords = Object.values(keywords).filter(k => 
        k.trigger === wordInfo.word
    );
    
    if (matchingKeywords.length === 0) return;
    
    // Create popup
    currentPopup = createPopup();
    currentTarget = element;
    
    // Add keywords to popup
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
        
        // Create preview
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
            
            if (isContentEditable) {
                expandKeywordInContentEditable(element, keyword.expansion, wordInfo);
            } else {
                expandKeyword(element, keyword.expansion, wordInfo);
            }
            
            hidePopup(currentPopup);
            currentPopup = null;
            currentTarget = null;
            
            setTimeout(() => {
                isExpanding = false;
            }, 100);
        });
        
        currentPopup.appendChild(item);
    });
    
    positionPopup(currentPopup, element);
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

// Add event listeners
document.addEventListener('input', handleInput, true);
document.addEventListener('click', handleClickOutside, true);
document.addEventListener('keydown', handleKeyDown, true);

// Handle window resize to reposition popup
window.addEventListener('resize', () => {
    if (currentPopup && currentTarget) {
        positionPopup(currentPopup, currentTarget);
    }
});

// Handle scroll to reposition popup
window.addEventListener('scroll', () => {
    if (currentPopup && currentTarget) {
        positionPopup(currentPopup, currentTarget);
    }
}, true);