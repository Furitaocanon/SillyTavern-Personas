(() => {
    'use strict';

    const EXT_NAME = 'personas';
    const VERSION = '1.3.1';
    const DEBUG = true;

    const SELECTORS = {
        personaManagement: '#persona-management-block',
        headerRow: '#persona-management-block .persona_management_left_column .flex-container.marginBot10.alignitemscenter',
        avatarBlock: '#user_avatar_block',
        avatarCard: '.avatar-container',
        nameBlock: '.character_name_block',
        nameSpan: '.ch_name',
        altHeaderSelectors: [
            '#persona-management-block .flex-container:has(#persona_search_bar)',
            '#persona-management-block .flex-container:has(#create_dummy_persona)',
            '.persona_management_left_column .flex-container:first-child',
            '#persona_search_bar',
            '#create_dummy_persona'
        ]
    };

    const IDS = {
        filterWrapper: 'pgm-filter-wrapper',
        filterSelect: 'pgm-filter-select',
        tagsToggle: 'pgm-tags-toggle',
        popover: 'pgm-popover',
        backdrop: 'pgm-backdrop'
    };

    const CLASSES = {
        groupBtn: 'pgm-group-btn',
        active: 'pgm-active'
    };

    // Get SillyTavern context
    const { extensionSettings, saveSettingsDebounced } = SillyTavern.getContext();

    // Define default settings
    const defaultSettings = Object.freeze({
        selectedGroup: '',
        personaGroups: {},
        showTags: false
    });

    // Settings management
    function getSettings() {
        if (!extensionSettings[EXT_NAME]) {
            extensionSettings[EXT_NAME] = structuredClone(defaultSettings);
        }

        // Ensure all default keys exist
        for (const key of Object.keys(defaultSettings)) {
            if (!Object.hasOwn(extensionSettings[EXT_NAME], key)) {
                extensionSettings[EXT_NAME][key] = defaultSettings[key];
            }
        }

        return extensionSettings[EXT_NAME];
    }

    // Initialize settings
    let settings = getSettings();

    let observers = {
        body: null,
        avatars: null
    };

    let isUpdating = false;
    let initRetryCount = 0;
    const MAX_INIT_RETRIES = 20;

    async function init() {
        log('Initializing extension v' + VERSION + '...');
        await loadSettings();
        setupObservers();
        const initUI = () => {
            initRetryCount++;
            log(`UI init attempt ${initRetryCount}/${MAX_INIT_RETRIES}`);

            if (createUI()) {
                log('UI created successfully');
                return;
            }

            if (initRetryCount < MAX_INIT_RETRIES) {
                setTimeout(initUI, 200);
            } else {
                warn('Failed to initialize UI after', MAX_INIT_RETRIES, 'attempts');
            }
        };

        initUI();
        setTimeout(initUI, 100);
        setTimeout(initUI, 500);
        setTimeout(initUI, 1000);
        setTimeout(initUI, 2000);

        log('Extension initialization started');
    }

    function unload() {
        log('Unloading extension...');
        observers.body?.disconnect();
        observers.avatars?.disconnect();
        closePopover();
        cleanupUI();
    }

    async function loadSettings() {
        settings = getSettings();
        log('Settings loaded from SillyTavern context');
    }

    async function saveSettings() {
        // Update the extension settings directly
        Object.assign(extensionSettings[EXT_NAME], settings);

        // Use SillyTavern's save function
        saveSettingsDebounced();

        log('Settings saved via SillyTavern');
    }

    async function exportGroups() {
        try {
            const data = {
                version: VERSION,
                timestamp: Date.now(),
                selectedGroup: settings.selectedGroup,
                personaGroups: settings.personaGroups,
                showTags: settings.showTags
            };

            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `personas-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            log('Groups exported successfully');
            return true;
        } catch (e) {
            warn('Export failed:', e);
            return false;
        }
    }

    async function importGroups(file) {
        try {
            const text = await file.text();
            const data = JSON.parse(text);

            if (data.personaGroups) {
                const oldCount = Object.keys(settings.personaGroups).length;

                settings.selectedGroup = data.selectedGroup || '';
                settings.personaGroups = { ...settings.personaGroups, ...data.personaGroups };
                settings.showTags = data.showTags !== undefined ? data.showTags : settings.showTags;

                await saveSettings();
                updateFilterOptions();
                updateAvatarCards();
                applyFilter();

                const newCount = Object.keys(settings.personaGroups).length;
                log(`Groups imported successfully. Personas: ${oldCount} -> ${newCount}`);

                alert(`Import successful!\nPersonas before: ${oldCount}\nPersonas after: ${newCount}`);
                return true;
            } else {
                throw new Error('Invalid file format');
            }
        } catch (e) {
            warn('Import failed:', e);
            alert('Import failed: ' + e.message);
            return false;
        }
    }

    function setupObservers() {
        observers.body = new MutationObserver(debounce(() => {
            if (isUpdating) return;

            log('DOM changed, updating UI...');
            createUI();
        }, 150));

        observers.body.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });

        const setupAvatarObserver = () => {
            const avatarBlock = document.querySelector(SELECTORS.avatarBlock);
            if (!avatarBlock) return;
            if (observers.avatars?.target === avatarBlock) return;
            observers.avatars?.disconnect();
            observers.avatars = new MutationObserver(debounce(() => {
                if (isUpdating) return;
                log('Avatar list changed, updating cards...');
                updateAvatarCards();
            }, 100));

            observers.avatars.target = avatarBlock;
            observers.avatars.observe(avatarBlock, {
                childList: true,
                subtree: true
            });

            log('Avatar observer setup for:', avatarBlock);
        };

        setupAvatarObserver();

        setInterval(() => {
            setupAvatarObserver();
            if (isPersonaManagerVisible() && !document.getElementById(IDS.filterWrapper)) {
                log('Periodic check: recreating UI');
                createUI();
            }
        }, 3000);
    }

    function createUI() {
        if (!isPersonaManagerVisible()) {
            log('Persona manager not visible, skipping UI creation');
            return false;
        }

        log('Creating UI...');

        const filterCreated = createFilterUI();
        const toggleCreated = createTagsToggle();
        const toolsCreated = createToolsButtons();

        if (filterCreated || toggleCreated || toolsCreated) {
            updateAvatarCards();
            log('UI creation successful');
            return true;
        }

        log('UI creation failed');
        return false;
    }

    function createToolsButtons() {
        const header = getHeaderRow();
        if (!header) return false;

        if (header.querySelector('.pgm-tools')) return true;

        const toolsContainer = createElement('div', {
            className: 'pgm-tools'
        });

        const exportBtn = createElement('button', {
            type: 'button',
            className: 'pgm-export-btn menu_button',
            innerHTML: '<i class="fa-solid fa-download"></i>',
            title: 'Export groups'
        });

        const importBtn = createElement('button', {
            type: 'button',
            className: 'pgm-import-btn menu_button',
            innerHTML: '<i class="fa-solid fa-upload"></i>',
            title: 'Import groups'
        });

        const fileInput = createElement('input', {
            type: 'file',
            accept: '.json',
            style: 'display: none'
        });

        exportBtn.addEventListener('click', exportGroups);

        importBtn.addEventListener('click', () => {
            fileInput.click();
        });

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                importGroups(file);
            }
            fileInput.value = '';
        });

        toolsContainer.append(exportBtn, importBtn, fileInput);
        header.appendChild(toolsContainer);

        log('Tools buttons created successfully');
        return true;
    }

    function createFilterUI() {
        if (document.getElementById(IDS.filterWrapper)) {
            updateFilterOptions();
            return true;
        }

        const header = getHeaderRow();
        if (!header) {
            log('Header not found for filter UI');
            return false;
        }

        log('Creating filter UI in:', header);

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
        log('Filter UI created successfully');
        return true;
    }

    function createTagsToggle() {
        if (document.getElementById(IDS.tagsToggle)) {
            updateTagsToggleButton();
            return true;
        }

        const header = getHeaderRow();
        if (!header) {
            log('Header not found for tags toggle');
            return false;
        }

        log('Creating tags toggle in:', header);

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
            updateTagsToggleButton();
            updateAvatarCards();
            log('Tags toggle clicked, new state:', settings.showTags);
        });

        header.appendChild(btn);
        updateTagsToggleButton();
        log('Tags toggle created successfully');
        return true;
    }

    function updateTagsToggleButton() {
        const btn = document.getElementById(IDS.tagsToggle);
        if (!btn) return;

        btn.classList.toggle(CLASSES.active, settings.showTags);
        btn.title = settings.showTags ? 'Hide group management' : 'Show group management';
    }

    function updateAvatarCards() {
        if (isUpdating) return;
        isUpdating = true;

        try {
            log('Updating avatar cards...');

            if (!settings.showTags) {
                document.querySelectorAll(`.${CLASSES.groupBtn}`).forEach(btn => {
                    btn.style.display = 'none';
                });
                return;
            }

            const avatarCards = getAvatarCards();
            log('Found', avatarCards.length, 'avatar cards');

            avatarCards.forEach(card => {
                const avatarId = card.dataset.avatarId;
                if (!avatarId) return;

                const nameBlock = card.querySelector(SELECTORS.nameBlock);
                if (!nameBlock) return;

                let groupBtn = nameBlock.querySelector(`.${CLASSES.groupBtn}`);
                if (!groupBtn) {
                    groupBtn = createElement('button', {
                        type: 'button',
                        className: `${CLASSES.groupBtn} menu_button`,
                        innerHTML: '<i class="fa-solid fa-tags"></i>',
                        title: 'Manage groups'
                    });

                    groupBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        log('Opening group manager for:', avatarId);
                        openGroupManager(e.target, avatarId);
                    });

                    groupBtn.addEventListener('mousedown', (e) => {
                        e.stopPropagation();
                    });

                    const nameSpan = nameBlock.querySelector(SELECTORS.nameSpan);
                    if (nameSpan && nameSpan.parentNode === nameBlock) {
                        nameSpan.insertAdjacentElement('afterend', groupBtn);
                    } else {
                        nameBlock.appendChild(groupBtn);
                    }
                }

                groupBtn.style.display = 'inline-block';
            });

            log('Avatar cards updated successfully');
        } finally {
            isUpdating = false;
        }
    }

    function openGroupManager(anchor, avatarId) {
        log('Opening group manager for avatar:', avatarId);
        closePopover();

        const backdrop = createElement('div', {
            id: IDS.backdrop,
            className: 'pgm-backdrop'
        });

        const popover = createElement('div', {
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
            className: 'pgm-add-input',
            placeholder: 'New group name'
        });

        const addBtn = createElement('button', {
            type: 'button',
            className: 'pgm-add-btn menu_button',
            textContent: 'Add'
        });

        const closeBtn = createElement('button', {
            type: 'button',
            className: 'pgm-close-btn menu_button',
            textContent: 'Done'
        });

        function renderGroupsList() {
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

                checkbox.addEventListener('change', () => {
                    if (checkbox.checked) {
                        addPersonaToGroup(avatarId, name);
                    } else {
                        removePersonaFromGroup(avatarId, name);
                    }
                    setTimeout(renderGroupsList, 50);
                    log('Group', name, checkbox.checked ? 'added to' : 'removed from', avatarId);
                });

                row.append(checkbox, nameSpan, countSpan);
                groupsList.appendChild(row);
            });
        }

        function handleEscapeKey(e) {
            if (e.key === 'Escape') closePopover();
        }

        addBtn.addEventListener('click', () => {
            const groupName = addInput.value.trim();
            if (!groupName) return;

            addPersonaToGroup(avatarId, groupName);
            addInput.value = '';
            renderGroupsList();
            log('Added group:', groupName, 'to avatar:', avatarId);
        });

        addInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                addBtn.click();
            }
            if (e.key === 'Escape') {
                closePopover();
            }
        });

        closeBtn.addEventListener('click', closePopover);

        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) closePopover();
        });

        document.addEventListener('keydown', handleEscapeKey);

        const preventBubbling = (e) => {
            e.stopPropagation();
        };

        popover.addEventListener('click', preventBubbling);
        popover.addEventListener('mousedown', preventBubbling);
        popover.addEventListener('mouseup', preventBubbling);

        addSection.append(addInput, addBtn);
        popover.append(title, groupsList, addSection, closeBtn);

        document.body.append(backdrop, popover);

        positionPopover(popover, anchor);

        renderGroupsList();

        popover._cleanup = () => {
            document.removeEventListener('keydown', handleEscapeKey);
            popover.removeEventListener('click', preventBubbling);
            popover.removeEventListener('mousedown', preventBubbling);
            popover.removeEventListener('mouseup', preventBubbling);
        };

        log('Group manager opened successfully');
    }

    function closePopover() {
        const popover = document.getElementById(IDS.popover);
        const backdrop = document.getElementById(IDS.backdrop);

        if (popover?._cleanup) {
            try {
                popover._cleanup();
                log('Popover cleanup completed');
            } catch (e) {
                warn('Popover cleanup error:', e);
            }
        }

        backdrop?.remove();
        popover?.remove();
        log('Popover closed');
    }

    function positionPopover(popover, anchor) {
        const isMobile = window.innerWidth <= 768;

        if (isMobile) {
            const width = Math.min(300, window.innerWidth - 20);
            const height = Math.min(400, window.innerHeight - 40);

            popover.style.width = `${width}px`;
            popover.style.maxHeight = `${height}px`;
            popover.style.left = `${(window.innerWidth - width) / 2}px`;
            popover.style.top = `${(window.innerHeight - height) / 2}px`;
            return;
        }

        const rect = anchor.getBoundingClientRect();
        let left = rect.left;
        let top = rect.bottom + 8;

        if (left + 300 > window.innerWidth) {
            left = window.innerWidth - 310;
        }
        if (top + 400 > window.innerHeight) {
            top = rect.top - 408;
        }

        popover.style.left = `${Math.max(10, left)}px`;
        popover.style.top = `${Math.max(10, top)}px`;
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
            applyFilter();
            log('Added', avatarId, 'to group', groupName);
        }
    }

    async function removePersonaFromGroup(avatarId, groupName) {
        if (!settings.personaGroups[avatarId]) return;

        const groups = settings.personaGroups[avatarId];
        const index = groups.indexOf(groupName);
        if (index > -1) {
            groups.splice(index, 1);
            await saveSettings();
            updateFilterOptions();
            applyFilter();
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

    function updateFilterOptions() {
        const select = document.getElementById(IDS.filterSelect);
        if (!select) return;

        const currentValue = select.value;
        const groups = getAllGroups();
        const currentWidth = select.offsetWidth;
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

        if (settings.selectedGroup && groups.some(g => g.name === settings.selectedGroup)) {
            select.value = settings.selectedGroup;
        } else if (currentValue && groups.some(g => g.name === currentValue)) {
            select.value = currentValue;
        } else {
            select.value = '';
            settings.selectedGroup = '';
        }

        if (currentWidth > 0) {
            select.style.minWidth = `${Math.max(currentWidth, 120)}px`;
        }

        log('Filter options updated, groups:', groups.length);
    }

    function applyFilter() {
        const avatarCards = getAvatarCards();
        const selectedGroup = settings.selectedGroup;

        log('Applying filter:', selectedGroup || 'All', 'to', avatarCards.length, 'cards');

        avatarCards.forEach(card => {
            const avatarId = card.dataset.avatarId;
            if (!avatarId) return;

            const personaGroups = settings.personaGroups[avatarId] || [];
            const shouldShow = !selectedGroup || personaGroups.includes(selectedGroup);

            card.style.display = shouldShow ? '' : 'none';
        });
    }

    function isPersonaManagerVisible() {
        const manager = document.querySelector(SELECTORS.personaManagement);
        const isVisible = !!manager && manager.offsetParent !== null;
        if (DEBUG && isVisible !== isPersonaManagerVisible._lastState) {
            log('Persona manager visibility changed:', isVisible);
            isPersonaManagerVisible._lastState = isVisible;
        }
        return isVisible;
    }

    function getHeaderRow() {
        let header = document.querySelector(SELECTORS.headerRow);
        if (header) return header;

        for (const selector of SELECTORS.altHeaderSelectors) {
            try {
                const element = document.querySelector(selector);
                if (element) {
                    header = element.closest('.flex-container') || element.parentElement;
                    if (header) {
                        log('Found header using alternative selector:', selector);
                        return header;
                    }
                }
            } catch (e) {
                // Ignore selector errors
            }
        }

        const leftColumn = document.querySelector('.persona_management_left_column');
        if (leftColumn) {
            header = leftColumn.querySelector('.flex-container');
            if (header) {
                log('Found header in left column');
                return header;
            }
        }

        log('Header not found');
        return null;
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

    function cleanupUI() {
        document.getElementById(IDS.filterWrapper)?.remove();
        document.getElementById(IDS.tagsToggle)?.remove();
        document.querySelector('.pgm-tools')?.remove();
        document.querySelectorAll(`.${CLASSES.groupBtn}`).forEach(btn => btn.remove());
        log('UI cleaned up');
    }

    function log(...args) {
        if (DEBUG) console.log(`[${EXT_NAME}]`, ...args);
    }

    function warn(...args) {
        console.warn(`[${EXT_NAME}]`, ...args);
    }

    // Debug functions
    window.pgmSync = async function() {
        await saveSettings();
        const info = {
            personas: Object.keys(settings.personaGroups).length,
            totalGroups: getAllGroups().length,
            settings: settings,
            isManagerVisible: isPersonaManagerVisible(),
            headerFound: !!getHeaderRow(),
            avatarCards: getAvatarCards().length
        };
        console.log(`[${EXT_NAME}] Sync completed:`, info);
        return info;
    };

    window.pgmReset = async function() {
        if (confirm('Delete ALL persona groups data?')) {
            settings.personaGroups = {};
            settings.selectedGroup = '';
            await saveSettings();
            createUI();
            log('All data cleared');
        }
    };

    window.pgmDebug = function() {
        return {
            version: VERSION,
            settings: settings,
            isManagerVisible: isPersonaManagerVisible(),
            headerRow: getHeaderRow(),
            avatarCards: getAvatarCards().length,
            filterExists: !!document.getElementById(IDS.filterWrapper),
            toggleExists: !!document.getElementById(IDS.tagsToggle),
            toolsExists: !!document.querySelector('.pgm-tools')
        };
    };

    window.pgmExport = exportGroups;
    window.pgmImport = function() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) importGroups(file);
        };
        input.click();
    };

    // Extension registration
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

})();