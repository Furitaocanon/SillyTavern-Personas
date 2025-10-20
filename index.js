(() => {
    'use strict';

    const EXT_NAME = 'personas';
    const VERSION = '2.2.0';
    const DEBUG = false;

    const SELECTORS = {
        personaManagement: '#persona-management-block',
        headerRow: '#persona-management-block .persona_management_left_column .flex-container.marginBot10.alignitemscenter',
        avatarBlock: '#user_avatar_block',
        avatarCard: '.avatar-container',
        nameBlock: '.character_name_block',
        nameSpan: '.ch_name'
    };

    const IDS = {
        filterWrapper: 'pgm-filter-wrapper',
        filterSelect: 'pgm-filter-select',
        tagsToggle: 'pgm-tags-toggle',
        folderToggle: 'pgm-folder-toggle',
        folderHeader: 'pgm-folder-header',
        backButton: 'pgm-back-button',
        popover: 'pgm-popover',
        backdrop: 'pgm-backdrop'
    };

    const CLASSES = {
        groupBtn: 'pgm-group-btn',
        active: 'pgm-active',
        folderCard: 'pgm-folder-card',
        hidden: 'pgm-hidden',
        processed: 'pgm-processed'
    };

    const { extensionSettings, saveSettingsDebounced, eventSource, event_types } = SillyTavern.getContext();

    const defaultSettings = Object.freeze({
        selectedGroup: '',
        personaGroups: {},
        showTags: false,
        showFolders: false
    });

    let settings = {};
    let isUICreated = false;
    let originalPersonaCards = new Map();
    let currentFolderView = null;
    let lastCardsCount = 0;
    let lastCardsHash = '';
    let checkInterval = null;

    function getSettings() {
        if (!extensionSettings[EXT_NAME]) {
            extensionSettings[EXT_NAME] = structuredClone(defaultSettings);
        }
        return extensionSettings[EXT_NAME];
    }

    async function saveSettings() {
        Object.assign(extensionSettings[EXT_NAME], settings);
        saveSettingsDebounced();
        log('Settings saved');
    }

    async function init() {
        log('Initializing extension v' + VERSION);
        settings = getSettings();
        setupEventListeners();
        setTimeout(tryCreateUI, 100);
        setInterval(checkPersonaManager, 2000);
        log('Extension initialized');
    }

    function setupEventListeners() {
        eventSource.on(event_types.SETTINGS_UPDATED, () => setTimeout(tryCreateUI, 100));
        eventSource.on(event_types.CHARACTER_PAGE_LOADED, () => setTimeout(tryCreateUI, 200));
    }

    function checkPersonaManager() {
        const isVisible = isPersonaManagerVisible();
        if (isVisible && !isUICreated) {
            tryCreateUI();
        } else if (!isVisible && isUICreated) {
            stopCardsMonitoring();
            isUICreated = false;
        }
    }

    function startCardsMonitoring() {
        if (checkInterval) return;

        checkInterval = setInterval(() => {
            if (!isPersonaManagerVisible()) return;

            const cards = getAvatarCards();
            const currentCount = cards.length;

            const currentHash = cards
                .map(card => card.dataset.avatarId || '')
                .filter(id => id && !id.startsWith('folder-'))
                .sort()
                .join('|');

            if (currentCount !== lastCardsCount || currentHash !== lastCardsHash) {
                log('Cards changed');
                lastCardsCount = currentCount;
                lastCardsHash = currentHash;
                storeOriginalCards();
                resetProcessedFlags();
                updateView();
            }
        }, 1000);

        log('Cards monitoring started');
    }

    function stopCardsMonitoring() {
        if (checkInterval) {
            clearInterval(checkInterval);
            checkInterval = null;
            log('Cards monitoring stopped');
        }
    }

    function tryCreateUI() {
        if (!isPersonaManagerVisible()) return false;

        if (isUICreated) return true;

        const success = createUI();
        if (success) {
            isUICreated = true;
            startCardsMonitoring();
            setTimeout(() => {
                storeOriginalCards();
                updateView();
            }, 100);
        }
        return success;
    }

    function createUI() {
        const header = getHeaderRow();
        if (!header) return false;

        createFilterUI(header);
        createTagsToggle(header);
        createFolderToggle(header);
        createFolderHeader();

        log('UI created successfully');
        return true;
    }

    function createFilterUI(header) {
        if (document.getElementById(IDS.filterWrapper)) return;

        const wrapper = createElement('div', {
            id: IDS.filterWrapper,
            className: 'pgm-filter'
        });

        const label = createElement('label', {
            textContent: 'Group:',
            className: 'pgm-filter-label'
        });

        const select = createElement('select', {
            id: IDS.filterSelect,
            className: 'pgm-filter-select menu_select'
        });

        const resetBtn = createElement('button', {
            type: 'button',
            textContent: 'Reset',
            className: 'pgm-filter-btn menu_button'
        });

        select.addEventListener('change', () => {
            settings.selectedGroup = select.value;
            saveSettings();
            applyFilter();
        });

        resetBtn.addEventListener('click', () => {
            settings.selectedGroup = '';
            select.value = '';
            saveSettings();
            applyFilter();
        });

        wrapper.append(label, select, resetBtn);
        header.appendChild(wrapper);
        updateFilterOptions();
    }

    function createTagsToggle(header) {
    if (document.getElementById(IDS.tagsToggle)) return;

    const btn = createElement('button', {
        id: IDS.tagsToggle,
        type: 'button',
        className: 'pgm-tags-toggle menu_button',
        innerHTML: '<i class="fa-solid fa-tags"></i>',
        title: 'Toggle group management'
    });

    btn.addEventListener('click', () => {
        settings.showTags = !settings.showTags;
        saveSettings();
        updateTagsButton();
        resetProcessedFlags();

        if (settings.showFolders) {
            updateFolderCards();
            updatePersonaCards();
        } else {
            updatePersonaCards();
        }
    });

    header.appendChild(btn);
    updateTagsButton();
}

function updateFolderCards() {
    const folderCards = document.querySelectorAll(`.${CLASSES.folderCard}`);

    folderCards.forEach(folderCard => {
        const groupName = folderCard.dataset.groupName;
        if (!groupName) return;

        const nameBlock = folderCard.querySelector(SELECTORS.nameBlock);
        if (!nameBlock) return;

        const existingBtns = nameBlock.querySelectorAll('.pgm-folder-manage');
        existingBtns.forEach(btn => btn.remove());

        if (settings.showTags) {
            const groupBtn = createElement('button', {
                type: 'button',
                className: `${CLASSES.groupBtn} pgm-folder-manage menu_button`,
                innerHTML: '<i class="fa-solid fa-cog"></i>',
                title: 'Manage folder'
            });

            groupBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                openFolderManager(groupBtn, groupName);
            });

            groupBtn.addEventListener('mousedown', (e) => e.stopPropagation());
            groupBtn.addEventListener('mouseup', (e) => e.stopPropagation());

            const nameSpan = nameBlock.querySelector(SELECTORS.nameSpan);
            if (nameSpan) {
                nameSpan.insertAdjacentElement('afterend', groupBtn);
            } else {
                nameBlock.appendChild(groupBtn);
            }
        }
    });
}

    function createFolderToggle(header) {
        if (document.getElementById(IDS.folderToggle)) return;

        const btn = createElement('button', {
            id: IDS.folderToggle,
            type: 'button',
            className: 'pgm-folder-toggle menu_button',
            innerHTML: '<i class="fa-solid fa-folder"></i>',
            title: 'Toggle folder view'
        });

        btn.addEventListener('click', () => {
            settings.showFolders = !settings.showFolders;
            currentFolderView = null;
            saveSettings();
            updateFolderButton();
            resetProcessedFlags();
            updateView();
        });

        header.appendChild(btn);
        updateFolderButton();
    }

    function createFolderHeader() {
        const avatarBlock = document.querySelector(SELECTORS.avatarBlock);
        if (!avatarBlock || document.getElementById(IDS.folderHeader)) return;

        const folderHeader = createElement('div', {
            id: IDS.folderHeader,
            className: 'pgm-folder-header pgm-hidden'
        });

        const backButton = createElement('button', {
            id: IDS.backButton,
            type: 'button',
            className: 'pgm-back-button menu_button',
            innerHTML: '<i class="fa-solid fa-arrow-left"></i>',
            title: 'Back to folders'
        });

        const folderTitle = createElement('div', {
            className: 'pgm-folder-title',
            textContent: ''
        });

        backButton.addEventListener('click', () => {
            currentFolderView = null;
            updateView();
        });

        folderHeader.append(backButton, folderTitle);
        avatarBlock.parentNode.insertBefore(folderHeader, avatarBlock);
    }

    function updateTagsButton() {
        const btn = document.getElementById(IDS.tagsToggle);
        if (!btn) return;

        btn.classList.toggle(CLASSES.active, settings.showTags);
    }

    function updateFolderButton() {
        const btn = document.getElementById(IDS.folderToggle);
        if (!btn) return;

        btn.classList.toggle(CLASSES.active, settings.showFolders);
    }

    function storeOriginalCards() {
        const cards = getAvatarCards();
        let newCardsCount = 0;

        cards.forEach(card => {
            const avatarId = card.dataset.avatarId;
            if (avatarId && !card.classList.contains(CLASSES.folderCard) && !originalPersonaCards.has(avatarId)) {
                originalPersonaCards.set(avatarId, {
                    element: card.cloneNode(true),
                    visible: card.style.display !== 'none'
                });
                newCardsCount++;
            }
        });

        if (newCardsCount > 0) {
            log('Stored', newCardsCount, 'new cards. Total:', originalPersonaCards.size);
        }
    }

    function resetProcessedFlags() {
        const cards = getAvatarCards();
        cards.forEach(card => {
            card.classList.remove(CLASSES.processed);
        });
    }

    function updateView() {
        const folderHeader = document.getElementById(IDS.folderHeader);

        if (settings.showFolders) {
            if (currentFolderView) {
                showFolderContent(currentFolderView);
                if (folderHeader) {
                    folderHeader.classList.remove(CLASSES.hidden);
                    const title = folderHeader.querySelector('.pgm-folder-title');
                    if (title) {
                        const personasCount = getPersonasInGroup(currentFolderView).length;
                        title.textContent = `${currentFolderView} (${personasCount})`;
                    }
                }
            } else {
                showFolderView();
                if (folderHeader) {
                    folderHeader.classList.add(CLASSES.hidden);
                }
            }
        } else {
            showNormalView();
            if (folderHeader) {
                folderHeader.classList.add(CLASSES.hidden);
            }
        }
        updateFilterState();
    }

    function showFolderView() {
        const avatarBlock = document.querySelector(SELECTORS.avatarBlock);
        if (!avatarBlock) return;

        avatarBlock.querySelectorAll(`.${CLASSES.folderCard}`).forEach(el => el.remove());

        const groups = getAllGroups();
        const usedPersonas = new Set();

        log('Creating folders for groups:', groups.map(g => g.name));

        groups.forEach(({ name, count }) => {
            const personasInGroup = getPersonasInGroup(name);
            if (personasInGroup.length === 0) return;

            const firstPersonaId = personasInGroup[0];
            const originalCard = originalPersonaCards.get(firstPersonaId);
            if (!originalCard) {
                log('Warning: No original card found for persona:', firstPersonaId);
                return;
            }

            const folderCard = createFolderCard(name, count, originalCard.element, personasInGroup);
            avatarBlock.appendChild(folderCard);

            personasInGroup.forEach(id => usedPersonas.add(id));
            log('Created folder:', name, 'with personas:', personasInGroup);
        });

        originalPersonaCards.forEach((data, avatarId) => {
            const currentCard = avatarBlock.querySelector(`[data-avatar-id="${avatarId}"]:not(.${CLASSES.folderCard})`);
            if (currentCard) {
                currentCard.style.display = usedPersonas.has(avatarId) ? 'none' : '';
                currentCard.classList.remove(CLASSES.hidden);
            }
        });

        updatePersonaCards();
        log('Folder view created with', groups.length, 'folders');
    }

    function showFolderContent(folderName) {
        const avatarBlock = document.querySelector(SELECTORS.avatarBlock);
        if (!avatarBlock) return;

        const personasInFolder = getPersonasInGroup(folderName);

        avatarBlock.querySelectorAll(`.${CLASSES.folderCard}`).forEach(el => el.remove());

        originalPersonaCards.forEach((data, avatarId) => {
            const currentCard = avatarBlock.querySelector(`[data-avatar-id="${avatarId}"]`);
            if (currentCard) {
                if (personasInFolder.includes(avatarId)) {
                    currentCard.style.display = '';
                    currentCard.classList.remove(CLASSES.hidden);
                } else {
                    currentCard.style.display = 'none';
                    currentCard.classList.add(CLASSES.hidden);
                }
            }
        });

        updatePersonaCards();
        log('Showing folder content for:', folderName, 'with', personasInFolder.length, 'personas');
    }

    function showNormalView() {
        const avatarBlock = document.querySelector(SELECTORS.avatarBlock);
        if (!avatarBlock) return;

        avatarBlock.querySelectorAll(`.${CLASSES.folderCard}`).forEach(el => el.remove());

        originalPersonaCards.forEach((data, avatarId) => {
            const currentCard = avatarBlock.querySelector(`[data-avatar-id="${avatarId}"]`);
            if (currentCard) {
                currentCard.style.display = '';
                currentCard.classList.remove(CLASSES.hidden);
            }
        });

        updatePersonaCards();
        if (settings.selectedGroup) {
            applyFilter();
        }

        log('Normal view restored');
    }

    function createFolderCard(groupName, count, templateCard, personasInGroup) {
        const folderCard = templateCard.cloneNode(true);
        folderCard.classList.add(CLASSES.folderCard);
        folderCard.classList.add(CLASSES.processed);
        folderCard.dataset.groupName = groupName;
        folderCard.dataset.avatarId = `folder-${groupName}`;

        const nameSpan = folderCard.querySelector(SELECTORS.nameSpan);
        if (nameSpan) {
            nameSpan.textContent = `${groupName} (${count})`;
        }

        folderCard.querySelectorAll(`.${CLASSES.groupBtn}`).forEach(btn => btn.remove());

        if (settings.showTags) {
            const nameBlock = folderCard.querySelector(SELECTORS.nameBlock);
            if (nameBlock) {
                const groupBtn = createElement('button', {
                    type: 'button',
                    className: `${CLASSES.groupBtn} pgm-folder-manage menu_button`,
                    innerHTML: '<i class="fa-solid fa-cog"></i>',
                    title: 'Manage folder'
                });

                groupBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    openFolderManager(groupBtn, groupName);
                });

                groupBtn.addEventListener('mousedown', (e) => e.stopPropagation());
                groupBtn.addEventListener('mouseup', (e) => e.stopPropagation());

                const nameSpan = nameBlock.querySelector(SELECTORS.nameSpan);
                if (nameSpan) {
                    nameSpan.insertAdjacentElement('afterend', groupBtn);
                } else {
                    nameBlock.appendChild(groupBtn);
                }
            }
        }

        folderCard.addEventListener('click', (e) => {
            if (e.target.closest('.pgm-folder-manage')) {
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            currentFolderView = groupName;
            updateView();
        });

        folderCard.addEventListener('mousedown', (e) => {
            if (e.target.closest('.pgm-folder-manage')) {
                return;
            }
            e.preventDefault();
        });

        return folderCard;
    }

    function openFolderManager(anchor, groupName) {
    log('Opening folder manager for:', groupName);
    closePopup();

    const backdrop = createElement('div', {
        id: IDS.backdrop,
        className: 'pgm-backdrop'
    });

    const popup = createElement('div', {
        id: IDS.popover,
        className: 'pgm-popover'
    });

    const title = createElement('div', {
        className: 'pgm-popover-title',
        textContent: `Manage Folder: ${groupName}`
    });

    const personasList = createElement('div', {
        className: 'pgm-groups-list'
    });

    const deleteBtn = createElement('button', {
        type: 'button',
        textContent: 'Delete Folder',
        className: 'menu_button pgm-delete-folder-btn'
    });

    const closeBtn = createElement('button', {
        type: 'button',
        textContent: 'Done',
        className: 'pgm-close-btn menu_button'
    });

    const buttonRow = createElement('div', {
        className: 'pgm-button-row'
    });

    function renderPersonas() {
        const personasInGroup = getPersonasInGroup(groupName);
        personasList.innerHTML = '';

        if (personasInGroup.length === 0) {
            personasList.innerHTML = '<div class="pgm-empty">No personas in this folder</div>';
            return;
        }

        personasInGroup.forEach(avatarId => {
            const originalCard = originalPersonaCards.get(avatarId);
            if (!originalCard) return;

            const nameSpan = originalCard.element.querySelector(SELECTORS.nameSpan);
            const personaName = nameSpan ? nameSpan.textContent : avatarId;

            const row = createElement('div', {
                className: 'pgm-group-row pgm-persona-row'
            });

            const nameSpanEl = createElement('span', {
                textContent: personaName,
                className: 'pgm-group-name'
            });

            const removeBtn = createElement('button', {
                type: 'button',
                textContent: 'Remove',
                className: 'menu_button pgm-remove-persona-btn'
            });

            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                removePersonaFromGroup(avatarId, groupName);
                renderPersonas();

                const remainingPersonas = getPersonasInGroup(groupName);
                if (remainingPersonas.length === 0) {
                    closePopup();
                    currentFolderView = null;
                    updateView();
                } else {
                    if (currentFolderView === groupName) {
                        const folderHeader = document.getElementById(IDS.folderHeader);
                        if (folderHeader) {
                            const title = folderHeader.querySelector('.pgm-folder-title');
                            if (title) {
                                title.textContent = `${groupName} (${remainingPersonas.length})`;
                            }
                        }
                    }
                    resetProcessedFlags();
                    updateView();
                }
            });

            row.append(nameSpanEl, removeBtn);
            personasList.appendChild(row);
        });
    }

    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Delete folder "${groupName}"? All personas will be ungrouped.`)) {
            const personasInGroup = getPersonasInGroup(groupName);
            personasInGroup.forEach(avatarId => {
                removePersonaFromGroup(avatarId, groupName);
            });
            closePopup();
            currentFolderView = null;
            updateView();
        }
    });

    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closePopup();
    });

    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
            closePopup();
        }
    });

    function handleKeydown(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closePopup();
        }
    }

    document.addEventListener('keydown', handleKeydown);

    const preventBubbling = (e) => {
        e.stopPropagation();
    };

    popup.addEventListener('click', preventBubbling);
    popup.addEventListener('mousedown', preventBubbling);
    popup.addEventListener('mouseup', preventBubbling);

    buttonRow.append(deleteBtn, closeBtn);
    popup.append(title, personasList, buttonRow);
    document.body.append(backdrop, popup);

    positionPopup(popup, anchor);
    renderPersonas();

    popup._cleanup = () => {
        document.removeEventListener('keydown', handleKeydown);
    };
}

    function positionPopup(popup, anchor) {
        requestAnimationFrame(() => {
            const rect = anchor.getBoundingClientRect();
            const popupRect = popup.getBoundingClientRect();

            let left = rect.left + (rect.width / 2) - (popupRect.width / 2);
            let top = rect.bottom + 10;

            if (left + popupRect.width > window.innerWidth) {
                left = window.innerWidth - popupRect.width - 10;
            }
            if (left < 10) {
                left = 10;
            }

            if (top + popupRect.height > window.innerHeight) {
                top = rect.top - popupRect.height - 10;
            }
            if (top < 10) {
                top = 10;
            }

            popup.style.left = left + 'px';
            popup.style.top = top + 'px';
        });
    }

    function closePopup() {
        const popup = document.getElementById(IDS.popover);
        const backdrop = document.getElementById(IDS.backdrop);

        if (popup && popup._cleanup) {
            popup._cleanup();
        }

        backdrop?.remove();
        popup?.remove();
    }

    function updatePersonaCards() {
        const cards = getAvatarCards();

        cards.forEach(card => {
            if (card.classList.contains(CLASSES.folderCard)) return;

            if (card.classList.contains(CLASSES.processed)) return;

            const avatarId = card.dataset.avatarId;
            if (!avatarId) return;

            const nameBlock = card.querySelector(SELECTORS.nameBlock);
            if (!nameBlock) return;

            const existingBtns = nameBlock.querySelectorAll(`.${CLASSES.groupBtn}`);
            existingBtns.forEach(btn => btn.remove());

            if (settings.showTags) {
                const groupBtn = createElement('button', {
                    type: 'button',
                    className: `${CLASSES.groupBtn} menu_button`,
                    innerHTML: '<i class="fa-solid fa-tags"></i>',
                    title: 'Manage groups'
                });

                groupBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    openGroupManager(groupBtn, avatarId);
                });

                groupBtn.addEventListener('mousedown', (e) => e.stopPropagation());
                groupBtn.addEventListener('mouseup', (e) => e.stopPropagation());

                const nameSpan = nameBlock.querySelector(SELECTORS.nameSpan);
                if (nameSpan) {
                    nameSpan.insertAdjacentElement('afterend', groupBtn);
                } else {
                    nameBlock.appendChild(groupBtn);
                }
            }

            card.classList.add(CLASSES.processed);
        });
    }

    function openGroupManager(anchor, avatarId) {
        log('Opening group manager for:', avatarId);
        closePopup();

        const backdrop = createElement('div', {
            id: IDS.backdrop,
            className: 'pgm-backdrop'
        });

        const popup = createElement('div', {
            id: IDS.popover,
            className: 'pgm-popover'
        });

        const title = createElement('div', {
            className: 'pgm-popover-title',
            textContent: 'Manage Groups'
        });

        const groupsList = createElement('div', {
            className: 'pgm-groups-list'
        });

        const addSection = createElement('div', {
            className: 'pgm-add-section'
        });

        const addInput = createElement('input', {
            type: 'text',
            placeholder: 'New group name',
            className: 'pgm-add-input'
        });

        const addBtn = createElement('button', {
            type: 'button',
            textContent: 'Add',
            className: 'pgm-add-btn menu_button'
        });

        const closeBtn = createElement('button', {
            type: 'button',
            textContent: 'Done',
            className: 'pgm-close-btn menu_button'
        });

        function renderGroups() {
            const personaGroups = settings.personaGroups[avatarId] || [];
            const allGroups = getAllGroups();

            groupsList.innerHTML = '';

            if (allGroups.length === 0) {
                groupsList.innerHTML = '<div class="pgm-empty">No groups available</div>';
                return;
            }

            allGroups.forEach(({ name, count }) => {
                const isChecked = personaGroups.includes(name);

                const row = createElement('label', {
                    className: 'pgm-group-row'
                });

                const checkbox = createElement('input', {
                    type: 'checkbox',
                    checked: isChecked
                });

                const nameSpan = createElement('span', {
                    className: 'pgm-group-name',
                    textContent: name
                });

                const countSpan = createElement('span', {
                    className: 'pgm-group-count',
                    textContent: `(${count})`
                });

                checkbox.addEventListener('change', (e) => {
                    e.stopPropagation();
                    if (checkbox.checked) {
                        addPersonaToGroup(avatarId, name);
                    } else {
                        removePersonaFromGroup(avatarId, name);
                    }
                    setTimeout(() => {
                        renderGroups();
                        if (settings.showFolders) {
                            resetProcessedFlags();
                            updateView();
                        }
                    }, 50);
                });

                row.append(checkbox, nameSpan, countSpan);
                groupsList.appendChild(row);
            });
        }

        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const groupName = addInput.value.trim();
            if (!groupName) return;

            addPersonaToGroup(avatarId, groupName);
            addInput.value = '';
            renderGroups();

            if (settings.showFolders) {
                resetProcessedFlags();
                updateView();
            }
        });

        addInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                addBtn.click();
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closePopup();
            }
        });

        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closePopup();
        });

        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) {
                closePopup();
            }
        });

        function handleKeydown(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closePopup();
            }
        }

        document.addEventListener('keydown', handleKeydown);

        const preventBubbling = (e) => {
            e.stopPropagation();
        };

        popup.addEventListener('click', preventBubbling);
        popup.addEventListener('mousedown', preventBubbling);
        popup.addEventListener('mouseup', preventBubbling);

        addSection.append(addInput, addBtn);
        popup.append(title, groupsList, addSection, closeBtn);
        document.body.append(backdrop, popup);

        positionPopup(popup, anchor);
        renderGroups();

        popup._cleanup = () => {
            document.removeEventListener('keydown', handleKeydown);
        };
    }

    async function addPersonaToGroup(avatarId, groupName) {
        if (!settings.personaGroups[avatarId]) {
            settings.personaGroups[avatarId] = [];
        }

        const groups = settings.personaGroups[avatarId];
        if (!groups.includes(groupName)) {
            groups.push(groupName);
            await saveSettings();
            updateFilterOptions();
            log('Added', avatarId, 'to group', groupName);
        }
    }

    async function removePersonaFromGroup(avatarId, groupName) {
        if (!settings.personaGroups[avatarId]) return;

        const groups = settings.personaGroups[avatarId];
        const index = groups.indexOf(groupName);
        if (index > -1) {
            groups.splice(index, 1);
            if (groups.length === 0) {
                delete settings.personaGroups[avatarId];
            }
            await saveSettings();
            updateFilterOptions();
            log('Removed', avatarId, 'from group', groupName);
        }
    }

    function getAllGroups() {
        const groupCounts = {};

        Object.values(settings.personaGroups).forEach(groups => {
            groups.forEach(group => {
                groupCounts[group] = (groupCounts[group] || 0) + 1;
            });
        });

        return Object.entries(groupCounts)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    function getPersonasInGroup(groupName) {
        const personas = [];
        for (const [avatarId, groups] of Object.entries(settings.personaGroups)) {
            if (groups.includes(groupName)) {
                personas.push(avatarId);
            }
        }
        return personas;
    }

    function updateFilterOptions() {
        const select = document.getElementById(IDS.filterSelect);
        if (!select) return;

        const groups = getAllGroups();
        select.innerHTML = '';

        const allOption = createElement('option', {
            value: '',
            textContent: 'All'
        });
        select.appendChild(allOption);

        groups.forEach(({ name, count }) => {
            const option = createElement('option', {
                value: name,
                textContent: `${name} (${count})`
            });
            select.appendChild(option);
        });

        select.value = settings.selectedGroup || '';
    }

    function updateFilterState() {
        const wrapper = document.getElementById(IDS.filterWrapper);
        if (wrapper) {
            wrapper.style.opacity = (settings.showFolders && !currentFolderView) ? '0.5' : '';
            const select = document.getElementById(IDS.filterSelect);
            if (select) {
                select.disabled = (settings.showFolders && !currentFolderView);
            }
        }
    }

    function applyFilter() {
        if (settings.showFolders && !currentFolderView) return;

        const cards = getAvatarCards();
        const selectedGroup = settings.selectedGroup;

        cards.forEach(card => {
            if (card.classList.contains(CLASSES.folderCard)) return;

            const avatarId = card.dataset.avatarId;
            if (!avatarId) return;

            const personaGroups = settings.personaGroups[avatarId] || [];
            const shouldShow = !selectedGroup || personaGroups.includes(selectedGroup);

            card.style.display = shouldShow ? '' : 'none';
        });
    }

    function isPersonaManagerVisible() {
        const manager = document.querySelector(SELECTORS.personaManagement);
        return !!manager && manager.offsetParent !== null;
    }

    function getHeaderRow() {
        return document.querySelector(SELECTORS.headerRow) ||
               document.querySelector('.persona_management_left_column .flex-container');
    }

    function getAvatarCards() {
        const avatarBlock = document.querySelector(SELECTORS.avatarBlock);
        return avatarBlock ? Array.from(avatarBlock.querySelectorAll(SELECTORS.avatarCard)) : [];
    }

    function createElement(tag, props = {}) {
        const element = document.createElement(tag);
        Object.assign(element, props);
        return element;
    }

    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    function log(...args) {
        if (DEBUG) console.log(`[${EXT_NAME}]`, ...args);
    }

    function unload() {
        stopCardsMonitoring();
        closePopup();
        document.querySelectorAll(`.${CLASSES.folderCard}`).forEach(el => el.remove());
        document.getElementById(IDS.filterWrapper)?.remove();
        document.getElementById(IDS.tagsToggle)?.remove();
        document.getElementById(IDS.folderToggle)?.remove();
        document.getElementById(IDS.folderHeader)?.remove();
        resetProcessedFlags();
        log('Extension unloaded');
    }

    const registerExtension = window.registerExtension ||
                             (window.SillyTavern && window.SillyTavern.registerExtension);

    if (typeof registerExtension === 'function') {
        registerExtension({
            name: EXT_NAME,
            init: init,
            unload: unload
        });
        log('Extension registered via registerExtension');
    } else {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            setTimeout(init, 100);
        }
        window.addEventListener('beforeunload', unload);
        log('Extension registered via fallback method');
    }

    window.pgmDebug = function() {
        return {
            version: VERSION,
            settings: settings,
            isManagerVisible: isPersonaManagerVisible(),
            originalCards: originalPersonaCards.size,
            isUICreated: isUICreated,
            groups: getAllGroups(),
            currentFolderView: currentFolderView,
            processedCards: document.querySelectorAll(`.${CLASSES.processed}`).length,
            lastCardsCount: lastCardsCount,
            lastCardsHash: lastCardsHash.substring(0, 100) + '...',
            monitoringActive: !!checkInterval
        };
    };

    window.pgmReset = async function() {
        if (confirm('Delete ALL persona groups data?')) {
            settings.personaGroups = {};
            settings.selectedGroup = '';
            settings.showFolders = false;
            settings.showTags = false;
            currentFolderView = null;
            await saveSettings();
            resetProcessedFlags();
            updateView();
            log('All data cleared');
        }
    };

    window.pgmForceUpdate = function() {
        log('Force update triggered');
        lastCardsCount = -1;
        lastCardsHash = '';
        resetProcessedFlags();
        storeOriginalCards();
        updateView();
    };

})();