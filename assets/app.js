const API_BASE = 'api';
const THEME_STORAGE_KEY = 'theme_mode';
const DEFAULT_REPORT_INTERVAL_MS = 300000;
const REFRESH_MS = 15000;
const AMAP_TILE_URL = 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}';
const USER_COLORS = ['#0d5f54', '#d9a441', '#3278bd', '#b4547a', '#5a7d2e', '#7b5fbd', '#c05f37', '#218a8a'];
const state = {
    user: null,
    map: null,
    markers: new Map(),
    refreshTimer: null,
    watchId: null,
    lastAutoReportAt: 0,
    lastImmediateAutoReportKey: '',
    reportIntervalMs: DEFAULT_REPORT_INTERVAL_MS,
    lastLocations: [],
    guardianContinuousReporting: false,
    history: [],
    historyMap: [],
    historyMembers: [],
    historyLayer: null,
    historyLineLayer: null,
    historyMarkers: new Map(),
    selectedGroupName: '',
    historyUserId: '',
    selectedHistoryId: null,
    historyPage: 1,
    historyPageSize: 20,
    historyMapPageSize: 20,
    historyPagination: null,
    addressDiagnostics: null,
};

const el = {
    loginView: document.querySelector('#loginView'),
    mainView: document.querySelector('#mainView'),
    loginForm: document.querySelector('#loginForm'),
    loginMessage: document.querySelector('#loginMessage'),
    username: document.querySelector('#username'),
    password: document.querySelector('#password'),
    termsAccepted: document.querySelector('#termsAccepted'),
    termsButton: document.querySelector('#termsButton'),
    privacyButton: document.querySelector('#privacyButton'),
    appTitle: document.querySelector('#appTitle'),
    accountLine: document.querySelector('#accountLine'),
    settingsButton: document.querySelector('#settingsButton'),
    logoutButton: document.querySelector('#logoutButton'),
    reportButton: document.querySelector('#reportButton'),
    continuousReportButton: document.querySelector('#continuousReportButton'),
    groupSelect: document.querySelector('#groupSelect'),
    liveStatus: document.querySelector('#liveStatus'),
    mapEmpty: document.querySelector('#mapEmpty'),
    mineLocation: document.querySelector('#mineLocation'),
    mineTime: document.querySelector('#mineTime'),
    addressDiagnostics: document.querySelector('#addressDiagnostics'),
    monitorLocations: document.querySelector('#monitorLocations'),
    guardianLocations: document.querySelector('#guardianLocations'),
    historyRefreshButton: document.querySelector('#historyRefreshButton'),
    historyUserFilter: document.querySelector('#historyUserFilter'),
    historyPageSize: document.querySelector('#historyPageSize'),
    historyMapPageSize: document.querySelector('#historyMapPageSize'),
    historyPrevButton: document.querySelector('#historyPrevButton'),
    historyNextButton: document.querySelector('#historyNextButton'),
    historyPageInfo: document.querySelector('#historyPageInfo'),
    historyList: document.querySelector('#historyList'),
    themeMode: document.querySelector('#themeMode'),
};

const systemThemeQuery = window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

function applyThemeMode(mode) {
    const normalized = ['system', 'light', 'dark'].includes(mode) ? mode : 'system';

    if (normalized === 'system') {
        delete document.documentElement.dataset.theme;
    } else {
        document.documentElement.dataset.theme = normalized;
    }

    window.localStorage.setItem(THEME_STORAGE_KEY, normalized);
    if (el.themeMode) {
        el.themeMode.value = normalized;
    }
    document.querySelectorAll('[data-theme-mode-select]').forEach((select) => {
        select.value = normalized;
    });
    updateThemeChrome(normalized);
    refreshPopupSelectControls();
}

function initThemeMode() {
    applyThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY) || 'system');
    if (systemThemeQuery) {
        const onSystemThemeChange = () => {
            const mode = window.localStorage.getItem(THEME_STORAGE_KEY) || 'system';
            if (mode === 'system') {
                updateThemeChrome(mode);
                if (state.map) {
                    state.map.invalidateSize();
                }
            }
        };

        if (systemThemeQuery.addEventListener) {
            systemThemeQuery.addEventListener('change', onSystemThemeChange);
        } else if (systemThemeQuery.addListener) {
            systemThemeQuery.addListener(onSystemThemeChange);
        }
    }
}

function effectiveTheme(mode = window.localStorage.getItem(THEME_STORAGE_KEY) || 'system') {
    if (mode === 'light' || mode === 'dark') {
        return mode;
    }

    return systemThemeQuery && systemThemeQuery.matches ? 'dark' : 'light';
}

function updateThemeChrome(mode) {
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
        metaThemeColor.setAttribute('content', effectiveTheme(mode) === 'dark' ? '#111816' : '#0d5f54');
    }
}

function refreshPopupSelectControls() {
    if (typeof window.refreshPopupSelects === 'function') {
        window.refreshPopupSelects();
    }
}

function showDocumentPopup(title, sections) {
    if (typeof window.showPopupDialog === 'function') {
        window.showPopupDialog({ title, sections });
        return;
    }

    openInlinePopupDialog(title, sections);
}

function showSimplePopup(title, paragraphs) {
    showDocumentPopup(title, [{
        title: '',
        paragraphs: Array.isArray(paragraphs) ? paragraphs : [String(paragraphs || '')],
    }]);
}

function openInlinePopupDialog(title, sections) {
    const overlay = document.createElement('div');
    overlay.className = 'popup-select-overlay';

    const card = document.createElement('div');
    card.className = 'popup-select-card popup-dialog-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');

    const heading = document.createElement('h2');
    heading.textContent = title;

    const body = document.createElement('div');
    body.className = 'popup-dialog-body';

    sections.forEach((section) => {
        if (section.title) {
            const sectionTitle = document.createElement('h3');
            sectionTitle.textContent = section.title;
            body.append(sectionTitle);
        }

        (section.paragraphs || []).forEach((text) => {
            const paragraph = document.createElement('p');
            paragraph.textContent = text;
            body.append(paragraph);
        });
    });

    const actions = document.createElement('div');
    actions.className = 'popup-dialog-actions';

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = '关闭';

    function close() {
        overlay.classList.remove('is-visible');
        window.setTimeout(() => overlay.remove(), 200);
    }

    closeButton.addEventListener('click', close);
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            close();
        }
    });

    function onKeydown(event) {
        if (!document.body.contains(overlay)) {
            document.removeEventListener('keydown', onKeydown);
            return;
        }

        if (event.key === 'Escape') {
            close();
            document.removeEventListener('keydown', onKeydown);
        }
    }
    document.addEventListener('keydown', onKeydown);

    actions.append(closeButton);
    card.append(heading, body, actions);
    overlay.append(card);
    document.body.append(overlay);
    window.requestAnimationFrame(() => overlay.classList.add('is-visible'));
    closeButton.focus();
}

async function api(path, options = {}) {
    const response = await fetch(`${API_BASE}/${path}.php`, {
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
        ...options,
    });

    const payload = await response.json().catch(() => ({
        ok: false,
        message: '服务器返回格式不正确。',
    }));

    if (!response.ok || payload.ok === false) {
        const error = new Error(payload.message || '请求失败。');
        error.payload = payload;
        error.status = response.status;
        throw error;
    }

    return payload;
}

function showLogin(message = '') {
    stopWatch();
    stopRefresh();
    clearNativeReportingState();
    clearHistory();
    renderAddressDiagnostics(null);
    state.user = null;
    state.selectedGroupName = '';
    state.guardianContinuousReporting = false;
    state.lastImmediateAutoReportKey = '';
    state.historyUserId = '';
    state.selectedHistoryId = null;
    el.reportButton.hidden = true;
    el.reportButton.disabled = false;
    el.continuousReportButton.hidden = true;
    el.continuousReportButton.disabled = false;
    updateContinuousReportButton();
    el.logoutButton.hidden = true;
    if (el.settingsButton) {
        el.settingsButton.hidden = true;
    }
    el.mainView.hidden = true;
    el.loginView.hidden = false;
    el.loginMessage.hidden = message === '';
    el.loginMessage.textContent = message;
}

function showMain(user) {
    state.user = user;
    setReportInterval(user.report_interval_seconds);
    stopWatch();
    el.loginView.hidden = true;
    el.mainView.hidden = false;
    el.logoutButton.hidden = false;
    if (el.settingsButton) {
        el.settingsButton.hidden = false;
    }
    initMap();
    startRefresh();
    applySelectedGroup(preferredGroupName(user), false);
    refreshLocations();
    refreshHistory();
    syncAutoReportWatch();
    checkFineLocationPermission();
}

function preferredGroupName(user) {
    const groups = userGroups(user);
    const saved = window.localStorage.getItem(`selected_group_${user.id}`) || '';

    if (groups.some((group) => group.group_name === saved)) {
        return saved;
    }

    if (groups.some((group) => group.group_name === user.group_name)) {
        return user.group_name;
    }

    return groups[0] ? groups[0].group_name : '';
}

function userGroups(user = state.user) {
    return user && Array.isArray(user.groups) ? user.groups : [];
}

function currentGroup() {
    return userGroups().find((group) => group.group_name === state.selectedGroupName) || null;
}

function applySelectedGroup(groupName, reload = true) {
    if (!state.user) {
        return;
    }

    const groups = userGroups();
    const group = groups.find((item) => item.group_name === groupName) || groups[0] || null;

    state.selectedGroupName = group ? group.group_name : '';
    if (group) {
        state.user.group_name = group.group_name;
        state.user.role = group.role;
        state.user.role_label = group.role_label;
        window.localStorage.setItem(`selected_group_${state.user.id}`, group.group_name);
    }

    renderGroupSelect();
    el.appTitle.textContent = state.user.role_label || '位置';
    el.accountLine.textContent = `${state.user.display_name || state.user.username} / ${state.selectedGroupName || '暂无家庭组'}`;

    state.guardianContinuousReporting = state.user.role === 'guardian'
        ? getGuardianContinuousReportingForGroup(state.selectedGroupName)
        : false;
    setGuardianContinuousReportingForGroup(state.selectedGroupName, state.guardianContinuousReporting);

    syncRoleControls();
    pushNativeReportingState();

    if (!reload) {
        return;
    }

    state.historyPage = 1;
    state.historyUserId = '';
    state.selectedHistoryId = null;
    state.lastAutoReportAt = 0;
    state.lastImmediateAutoReportKey = '';
    clearHistoryLayers();
    refreshLocations();
    refreshHistory();
    syncAutoReportWatch();
}

function renderGroupSelect() {
    if (!el.groupSelect) {
        return;
    }

    const groups = userGroups();
    const options = groups.length
        ? groups.map((group) => new Option(`${group.group_name} / ${group.role_label}`, group.group_name))
        : [new Option('暂无家庭组', '')];

    el.groupSelect.replaceChildren(...options);
    el.groupSelect.value = state.selectedGroupName;
    el.groupSelect.disabled = groups.length <= 1;
    refreshPopupSelectControls();
}

function shouldAutoReport() {
    return state.user
        && state.selectedGroupName !== ''
        && (state.user.role === 'monitor' || state.guardianContinuousReporting);
}

function syncAutoReportWatch() {
    if (shouldAutoReport()) {
        if (state.watchId === null) {
            startWatch();
        }
        requestImmediateAutoReport();
        return;
    }

    stopWatch();
    setStatus('等待手动上报');
}

function syncRoleControls() {
    const isGuardian = state.user && state.user.role === 'guardian';
    el.reportButton.hidden = !isGuardian;
    el.continuousReportButton.hidden = !isGuardian;

    if (!isGuardian) {
        state.guardianContinuousReporting = false;
    }

    updateContinuousReportButton();
}

function toggleGuardianContinuousReport() {
    if (!state.user || state.user.role !== 'guardian') {
        return;
    }

    state.guardianContinuousReporting = !state.guardianContinuousReporting;
    setGuardianContinuousReportingForGroup(state.selectedGroupName, state.guardianContinuousReporting);
    updateContinuousReportButton();
    syncAutoReportWatch();
    pushNativeReportingState();
}

function updateContinuousReportButton() {
    if (!el.continuousReportButton) {
        return;
    }

    el.continuousReportButton.textContent = state.guardianContinuousReporting ? '停止上报' : '持续上报';
}

function setReportInterval(seconds) {
    const parsed = Number(seconds);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return;
    }

    state.reportIntervalMs = Math.max(60000, parsed * 1000);
    pushNativeReportingState();
}

function pushNativeReportingState() {
    if (!state.user || !window.LocationBridge) {
        return;
    }

    try {
        const groupSessions = JSON.stringify(userGroups().map((group) => ({
            group_name: group.group_name,
            role: group.role,
            continuous: group.role === 'guardian'
                ? getLocalGuardianContinuousReporting(group.group_name)
                : true,
        })));

        if (typeof window.LocationBridge.setSessionState === 'function') {
            window.LocationBridge.setSessionState(
                state.user.role,
                state.guardianContinuousReporting,
                Math.round(state.reportIntervalMs / 1000),
                state.selectedGroupName,
                groupSessions
            );
            return;
        }

        try {
            window.LocationBridge.setSession(
                state.user.role,
                state.guardianContinuousReporting,
                Math.round(state.reportIntervalMs / 1000),
                state.selectedGroupName
            );
        } catch (error) {
            window.LocationBridge.setSession(
                state.user.role,
                state.guardianContinuousReporting,
                Math.round(state.reportIntervalMs / 1000)
            );
        }
    } catch (error) {
        console.warn(error);
    }
}

function clearNativeReportingState() {
    if (!window.LocationBridge) {
        return;
    }

    try {
        window.LocationBridge.clearSession();
    } catch (error) {
        console.warn(error);
    }
}

function checkFineLocationPermission() {
    if (!window.LocationBridge || typeof window.LocationBridge.hasFineLocationPermission !== 'function') {
        return;
    }

    try {
        if (window.LocationBridge.hasFineLocationPermission() !== true) {
            showPreciseLocationRequiredPopup(false);
        }
    } catch (error) {
        console.warn(error);
    }
}

function requestFineLocationPermissionAgain() {
    if (window.LocationBridge && typeof window.LocationBridge.requestFineLocationPermission === 'function') {
        try {
            window.LocationBridge.requestFineLocationPermission();
        } catch (error) {
            console.warn(error);
        }
    }
}

function showPreciseLocationRequiredPopup(requestAgain = true) {
    showSimplePopup('需要定位权限', [
        '请开启“始终允许定位”，并启用“精确位置”。否则持续上报、手动上报和地图定位可能无法正常工作。',
        '如果系统已经拒绝过权限，请到系统设置里的应用权限中手动开启。',
    ]);

    if (requestAgain) {
        requestFineLocationPermissionAgain();
    }
}

function openSettingsPopup() {
    const overlay = document.createElement('div');
    overlay.className = 'popup-select-overlay';

    const card = document.createElement('div');
    card.className = 'popup-select-card popup-dialog-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');

    const heading = document.createElement('h2');
    heading.textContent = '设置';

    const body = document.createElement('div');
    body.className = 'popup-dialog-body settings-dialog-body';

    const themeLabel = document.createElement('label');
    themeLabel.className = 'settings-field';
    const themeTitle = document.createElement('span');
    themeTitle.textContent = '深色模式';
    const themeSelect = document.createElement('select');
    themeSelect.dataset.themeModeSelect = '1';
    [
        ['system', '跟随系统'],
        ['light', '明亮'],
        ['dark', '暗色'],
    ].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        themeSelect.append(option);
    });
    themeSelect.value = window.localStorage.getItem(THEME_STORAGE_KEY) || 'system';
    themeSelect.addEventListener('change', () => applyThemeMode(themeSelect.value));
    themeLabel.append(themeTitle, themeSelect);

    body.append(themeLabel);

    const actions = document.createElement('div');
    actions.className = 'popup-dialog-actions';
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = '关闭';
    function close() {
        overlay.classList.remove('is-visible');
        window.setTimeout(() => overlay.remove(), 200);
    }
    closeButton.addEventListener('click', close);
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            close();
        }
    });
    actions.append(closeButton);
    card.append(heading, body, actions);
    overlay.append(card);
    document.body.append(overlay);
    refreshPopupSelectControls();
    window.requestAnimationFrame(() => overlay.classList.add('is-visible'));
}

function getGuardianContinuousReportingForGroup(groupName = state.selectedGroupName) {
    const localValue = getLocalGuardianContinuousReporting(groupName);

    if (!window.LocationBridge) {
        return localValue;
    }

    try {
        if (typeof window.LocationBridge.getGuardianContinuousReportingForGroup === 'function') {
            return window.LocationBridge.getGuardianContinuousReportingForGroup(groupName) === true || localValue;
        }

        if (groupName === state.selectedGroupName) {
            return window.LocationBridge.getGuardianContinuousReporting() === true || localValue;
        }
    } catch (error) {
        console.warn(error);
    }

    return localValue;
}

function getLocalGuardianContinuousReporting(groupName = state.selectedGroupName) {
    if (!state.user || !groupName) {
        return false;
    }

    return window.localStorage.getItem(guardianContinuousStorageKey(groupName)) === '1';
}

function setGuardianContinuousReportingForGroup(groupName, enabled) {
    if (!state.user || !groupName) {
        return;
    }

    window.localStorage.setItem(guardianContinuousStorageKey(groupName), enabled ? '1' : '0');
}

function guardianContinuousStorageKey(groupName) {
    return `guardian_continuous_${state.user.id}_${encodeURIComponent(groupName)}`;
}

function initMap() {
    if (typeof L === 'undefined') {
        el.mapEmpty.hidden = false;
        el.mapEmpty.textContent = '地图资源加载失败';
        setStatus('地图资源加载失败');
        return;
    }

    if (state.map) {
        setTimeout(() => state.map.invalidateSize(), 50);
        return;
    }

    state.map = L.map('map', {
        zoomControl: true,
        attributionControl: true,
    }).setView([35.8617, 104.1954], 4);

    L.tileLayer(AMAP_TILE_URL, {
        maxZoom: 19,
        subdomains: '1234',
        attribution: '&copy; 高德地图',
    }).addTo(state.map);
}

function startRefresh() {
    stopRefresh();
    state.refreshTimer = window.setInterval(refreshLocations, REFRESH_MS);
}

function stopRefresh() {
    if (state.refreshTimer) {
        window.clearInterval(state.refreshTimer);
        state.refreshTimer = null;
    }
}

function startWatch() {
    if (!navigator.geolocation) {
        setStatus('当前浏览器不支持定位');
        return;
    }

    stopWatch();
    setStatus('定位中');

    state.watchId = navigator.geolocation.watchPosition(
        (position) => {
            const now = Date.now();
            if (now - state.lastAutoReportAt >= state.reportIntervalMs) {
                state.lastAutoReportAt = now;
                reportPosition(position, true);
            }
        },
        (error) => {
            setStatus(locationErrorMessage(error));
            if (error.code === error.PERMISSION_DENIED) {
                showPreciseLocationRequiredPopup(true);
            }
        },
        {
            enableHighAccuracy: true,
            maximumAge: 10000,
            timeout: 20000,
        }
    );
}

function requestImmediateAutoReport() {
    if (!navigator.geolocation || !state.user || !shouldAutoReport()) {
        return;
    }

    const key = `${state.user.id}|${state.selectedGroupName}|${state.user.role}`;
    if (state.lastImmediateAutoReportKey === key) {
        return;
    }

    state.lastImmediateAutoReportKey = key;
    navigator.geolocation.getCurrentPosition(
        (position) => {
            state.lastAutoReportAt = Date.now();
            reportPosition(position, true);
        },
        (error) => {
            setStatus(locationErrorMessage(error));
            if (error.code === error.PERMISSION_DENIED) {
                showPreciseLocationRequiredPopup(true);
            }
        },
        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 20000,
        }
    );
}

function stopWatch() {
    if (state.watchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(state.watchId);
        state.watchId = null;
    }
}

function setStatus(text) {
    el.liveStatus.textContent = text;
}

function locationErrorMessage(error) {
    if (error.code === error.PERMISSION_DENIED) {
        return '定位权限被拒绝';
    }

    if (error.code === error.POSITION_UNAVAILABLE) {
        return '定位不可用';
    }

    if (error.code === error.TIMEOUT) {
        return '定位超时';
    }

    return '定位失败';
}

async function reportPosition(position, automatic = false) {
    if (!state.user) {
        return;
    }

    const { latitude, longitude, accuracy, heading, speed } = position.coords;
    const reportGroupName = state.selectedGroupName;

    try {
        if (!automatic) {
            el.reportButton.disabled = true;
        }

        const probeSession = createAddressProbeSession(latitude, longitude);
        let locationId = null;
        let diagnosticsUploading = false;
        let queuedDiagnostics = null;
        let addressDiagnostics = probeSession.current();
        const flushDiagnostics = async () => {
            if (!locationId || diagnosticsUploading || !queuedDiagnostics) {
                return;
            }

            diagnosticsUploading = true;
            try {
                while (queuedDiagnostics) {
                    const nextDiagnostics = queuedDiagnostics;
                    queuedDiagnostics = null;
                    await api('report_location', {
                        method: 'POST',
                        body: JSON.stringify({
                            group_name: reportGroupName,
                            location_id: locationId,
                            address_diagnostics: nextDiagnostics,
                            address_mismatch: nextDiagnostics.mismatch,
                        }),
                    });
                    if (preferredMapSource({
                        latitude,
                        longitude,
                        address_diagnostics: nextDiagnostics,
                    })) {
                        await refreshLocations();
                        await refreshHistory();
                    }
                }
            } catch (error) {
                console.warn(error);
            } finally {
                diagnosticsUploading = false;
                if (queuedDiagnostics) {
                    flushDiagnostics();
                }
            }
        };
        const queueDiagnostics = (diagnostics) => {
            addressDiagnostics = normalizeAddressDiagnostics(diagnostics);
            renderAddressDiagnostics(addressDiagnostics);
            queuedDiagnostics = addressDiagnostics;
            flushDiagnostics();
        };

        probeSession.onUpdate(queueDiagnostics);
        renderAddressDiagnostics(addressDiagnostics);

        setStatus(automatic ? '正在自动上报' : '正在上报');
        const report = await api('report_location', {
            method: 'POST',
            body: JSON.stringify({
                group_name: reportGroupName,
                latitude,
                longitude,
                accuracy,
                heading,
                speed,
                address_diagnostics: addressDiagnostics,
                address_mismatch: addressDiagnostics.mismatch,
            }),
        });
        locationId = Number(report.location_id) || null;
        flushDiagnostics();

        setStatus(addressDiagnostics.complete ? '位置已上报' : '位置已上报，地址继续探测中');
        await refreshLocations();
        await refreshHistory();
    } catch (error) {
        setStatus(error.message);
    } finally {
        el.reportButton.disabled = false;
    }
}

function manualReport() {
    if (!navigator.geolocation) {
        setStatus('当前浏览器不支持定位');
        return;
    }

    el.reportButton.disabled = true;
    setStatus('定位中');

    navigator.geolocation.getCurrentPosition(
        (position) => reportPosition(position, false),
        (error) => {
            el.reportButton.disabled = false;
            setStatus(locationErrorMessage(error));
            if (error.code === error.PERMISSION_DENIED) {
                showPreciseLocationRequiredPopup(true);
            }
        },
        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 20000,
        }
    );
}

async function refreshLocations() {
    if (!state.user) {
        return;
    }

    try {
        const data = await api('locations', {
            method: 'POST',
            body: JSON.stringify({ group_name: state.selectedGroupName }),
        });
        state.user = data.user;
        setReportInterval(data.report_interval_seconds);
        applySelectedGroup(data.selected_group ? data.selected_group.group_name : state.selectedGroupName, false);
        syncRoleControls();
        syncAutoReportWatch();
        state.lastLocations = data.locations || [];
        renderLocationCards(data);
        renderMarkers(visibleLatestLocations());
        setStatus(shouldAutoReport() ? '持续上报中' : '位置已同步');
    } catch (error) {
        if (/请先登录/.test(error.message)) {
            showLogin('登录已失效。');
            return;
        }

        setStatus(error.message);
    }
}

async function refreshHistory() {
    if (!state.user) {
        return;
    }

    try {
        const data = await api('history', {
            method: 'POST',
            body: JSON.stringify({
                group_name: state.selectedGroupName,
                page: state.historyPage,
                per_page: state.historyPageSize,
                map_per_user: state.historyMapPageSize,
                user_id: state.historyUserId,
            }),
        });
        state.history = data.history || [];
        state.historyMap = data.map_history || [];
        state.historyMembers = data.members || [];
        state.historyPagination = data.pagination || null;
        state.selectedHistoryId = null;
        renderHistory();
    } catch (error) {
        renderHistoryMessage(error.message);
        clearHistoryLayers();
    }
}

function clearHistory() {
    state.history = [];
    state.historyMap = [];
    state.historyMembers = [];
    state.historyPage = 1;
    state.historyPageSize = Number(el.historyPageSize ? el.historyPageSize.value : 20) || 20;
    state.historyMapPageSize = Number(el.historyMapPageSize ? el.historyMapPageSize.value : 20) || 20;
    state.historyPagination = null;
    state.historyUserId = '';
    state.selectedHistoryId = null;
    if (el.historyUserFilter) {
        el.historyUserFilter.replaceChildren(new Option('全部成员', ''));
    }
    refreshPopupSelectControls();
    renderHistoryPager();
    renderHistoryMessage('暂无历史位置');
    clearHistoryLayers();
}

function renderHistory() {
    renderHistoryFilter();
    renderHistoryPager();
    const records = filteredHistory();
    renderHistoryList(records);
    renderHistoryMap(historyMapRecords());
}

function renderHistoryFilter() {
    if (!el.historyUserFilter) {
        return;
    }

    const selected = state.historyUserId;
    const people = new Map();

    state.historyMembers.forEach((member) => {
        if (!people.has(member.user_id)) {
            people.set(member.user_id, `${member.display_name || member.username} / ${member.role_label}`);
        }
    });

    const options = [new Option('全部成员', '')];
    [...people.entries()]
        .sort((left, right) => left[1].localeCompare(right[1], 'zh-CN'))
        .forEach(([userId, label]) => {
            options.push(new Option(label, String(userId)));
        });

    if (selected && !people.has(Number(selected))) {
        state.historyUserId = '';
    }

    el.historyUserFilter.replaceChildren(...options);
    el.historyUserFilter.value = state.historyUserId;
    refreshPopupSelectControls();
}

function renderHistoryPager() {
    const pagination = state.historyPagination || {
        page: state.historyPage,
        total_pages: 1,
        total: 0,
    };

    if (el.historyPageInfo) {
        const perPage = pagination.per_page || state.historyPageSize;
        const mapPerUser = pagination.map_per_user || state.historyMapPageSize;
        el.historyPageInfo.textContent = `第 ${pagination.page} / ${pagination.total_pages} 页，共 ${pagination.total} 条，每页 ${perPage} 条，地图每人 ${mapPerUser} 条`;
    }

    if (el.historyPrevButton) {
        el.historyPrevButton.disabled = pagination.page <= 1;
    }

    if (el.historyNextButton) {
        el.historyNextButton.disabled = pagination.page >= pagination.total_pages;
    }
}

function changeHistoryPage(offset) {
    const pagination = state.historyPagination || { page: state.historyPage, total_pages: 1 };
    const nextPage = Math.min(Math.max(1, pagination.page + offset), pagination.total_pages);

    if (nextPage === pagination.page) {
        return;
    }

    state.historyPage = nextPage;
    refreshHistory();
}

function changeHistoryPageSize() {
    const selected = Number(el.historyPageSize ? el.historyPageSize.value : 20);
    state.historyPageSize = [20, 50, 100].includes(selected) ? selected : 20;
    state.historyPage = 1;
    refreshHistory();
}

function changeHistoryMapPageSize() {
    const selected = Number(el.historyMapPageSize ? el.historyMapPageSize.value : 20);
    state.historyMapPageSize = [20, 50, 100].includes(selected) ? selected : 20;
    refreshHistory();
}

function changeHistoryUserFilter() {
    state.historyUserId = el.historyUserFilter ? el.historyUserFilter.value : '';
    state.historyPage = 1;
    state.selectedHistoryId = null;
    renderMarkers(visibleLatestLocations());
    refreshHistory();
}

function filteredHistory() {
    return state.history;
}

function historyMapRecords() {
    const records = [...state.historyMap];
    if (!state.selectedHistoryId || records.some((location) => location.id === state.selectedHistoryId)) {
        return records;
    }

    const selected = state.history.find((location) => location.id === state.selectedHistoryId);
    if (selected) {
        records.push(selected);
    }

    return records;
}

function historyItemElement(locationId) {
    return el.historyList
        ? el.historyList.querySelector(`[data-history-id="${Number(locationId)}"]`)
        : null;
}

function withStableHistoryScroll(locationId, callback) {
    const beforeItem = historyItemElement(locationId);
    const beforeTop = beforeItem ? beforeItem.getBoundingClientRect().top : null;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const listScrollTop = el.historyList ? el.historyList.scrollTop : 0;

    callback();

    const restore = () => {
        if (el.historyList) {
            el.historyList.scrollTop = listScrollTop;
        }

        const afterItem = historyItemElement(locationId);
        if (beforeTop !== null && afterItem) {
            const delta = afterItem.getBoundingClientRect().top - beforeTop;
            if (Math.abs(delta) > 1) {
                window.scrollBy(0, delta);
            }
            return;
        }

        window.scrollTo(scrollX, scrollY);
    };

    restore();
    window.requestAnimationFrame(restore);
    window.setTimeout(restore, 0);
}

function renderHistoryList(records) {
    if (!el.historyList) {
        return;
    }

    if (!records.length) {
        renderHistoryMessage('暂无历史位置');
        return;
    }

    el.historyList.replaceChildren(
        ...records.map((location) => {
            const item = document.createElement('div');
            item.className = 'history-item';
            item.dataset.historyId = String(location.id);
            item.tabIndex = 0;
            item.setAttribute('role', 'button');
            item.setAttribute('aria-expanded', state.selectedHistoryId === location.id ? 'true' : 'false');
            item.style.setProperty('--user-color', userColor(location.user_id));

            if (state.selectedHistoryId === location.id) {
                item.classList.add('selected');
            }

            const title = document.createElement('div');
            title.className = 'history-title';

            const name = document.createElement('span');
            name.className = 'history-name';
            name.textContent = location.display_name || location.username;

            const role = document.createElement('span');
            role.className = `history-role ${location.role}`;
            role.textContent = location.role_label;

            const coord = document.createElement('div');
            coord.className = 'history-meta';
            coord.textContent = formatCoord(location);

            const time = document.createElement('div');
            time.className = 'history-meta';
            time.textContent = `上报时间：${location.created_at}`;

            title.append(name, role);
            item.append(title, coord, time);

            const statusText = locationAddressStatusText(location);
            if (statusText !== '位置信息一致或无法完整判断') {
                const mismatch = document.createElement('div');
                mismatch.className = 'history-meta';
                mismatch.textContent = statusText;
                item.append(mismatch);
            }

            if (state.selectedHistoryId === location.id) {
                item.append(renderHistoryDetails(location));
            }

            item.addEventListener('click', () => toggleHistorySelection(location.id));
            item.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggleHistorySelection(location.id);
                }
            });

            return item;
        })
    );
}

function renderHistoryDetails(location) {
    const details = document.createElement('div');
    details.className = 'history-details';
    const diagnostics = normalizeAddressDiagnostics(location.address_diagnostics);

    const rows = [
        ['家庭组', location.group_name || '未知'],
        ['坐标', formatCoord(location)],
        ['精度', location.accuracy === null ? '未知' : `${Math.round(location.accuracy)}m`],
        ['地址状态', addressDiagnosticsStatusText(diagnostics)],
    ];

    const heading = Number(location.heading);
    const speed = Number(location.speed);
    if (location.heading !== null && location.heading !== undefined && Number.isFinite(heading)) {
        rows.push(['方向', `${Math.round(heading)}°`]);
    }
    if (location.speed !== null && location.speed !== undefined && Number.isFinite(speed)) {
        rows.push(['速度', `${speed.toFixed(2)} m/s`]);
    }

    rows.forEach(([label, value]) => {
        const row = document.createElement('div');
        row.className = 'history-detail-row';
        row.append(historyDetailLabel(label), historyDetailValue(value));
        details.append(row);
    });

    if (diagnostics && Array.isArray(diagnostics.sources)) {
        if (diagnostics.checked_at) {
            const checked = document.createElement('div');
            checked.className = 'history-detail-row';
            checked.append(historyDetailLabel('对比时间'), historyDetailValue(diagnostics.checked_at));
            details.append(checked);
        }

        diagnostics.sources.forEach((source) => {
            const row = document.createElement('div');
            row.className = 'history-detail-row wide';
            row.append(
                historyDetailLabel(source.name || source.type || '地址'),
                historyDetailValue(`${source.address || source.ip || '未知'} / 城市：${cityDisplayName(source.city || inferCityFromText(source.address || '')) || '未知'}${source.mobile_network_uncertain ? ' / 移动网络出口省份不一致' : ''}`)
            );
            details.append(row);
        });
    }

    return details;
}

function addressDiagnosticsStatusText(diagnostics) {
    const normalized = normalizeAddressDiagnostics(diagnostics);
    if (!normalized || !Array.isArray(normalized.sources)) {
        return '位置信息一致或无法完整判断';
    }

    if (normalized.mismatch) {
        return '位置信息不一致';
    }

    if (normalized.mobile_ip_uncertain) {
        return '移动网络出口省份不一致';
    }

    return '位置信息一致或无法完整判断';
}

function locationAddressStatusText(location) {
    if (!location || !location.address_diagnostics) {
        return location && location.address_mismatch ? '位置信息不一致' : '位置信息一致或无法完整判断';
    }

    return addressDiagnosticsStatusText(location.address_diagnostics);
}

function historyDetailLabel(text) {
    const label = document.createElement('span');
    label.className = 'history-detail-label';
    label.textContent = text;
    return label;
}

function historyDetailValue(text) {
    const value = document.createElement('span');
    value.className = 'history-detail-value';
    value.textContent = text;
    return value;
}

function toggleHistorySelection(locationId) {
    withStableHistoryScroll(locationId, () => {
        const id = Number(locationId);
        state.selectedHistoryId = state.selectedHistoryId === id ? null : id;
        const records = filteredHistory();
        renderHistoryList(records);
        renderHistoryMap(historyMapRecords(), true);
    });
}

function selectHistory(locationId) {
    withStableHistoryScroll(locationId, () => {
        state.selectedHistoryId = Number(locationId);
        const records = filteredHistory();
        renderHistoryList(records);
        renderHistoryMap(historyMapRecords(), true);
    });
}

function renderHistoryMessage(message) {
    if (!el.historyList) {
        return;
    }

    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = message;
    el.historyList.replaceChildren(empty);
}

function renderHistoryMap(records, adjustViewport = true) {
    clearHistoryLayers();

    if (!state.map || typeof L === 'undefined') {
        return;
    }

    const latestLocations = visibleLatestLocations();
    el.mapEmpty.hidden = latestLocations.length > 0 || records.length > 0;

    if (!records.length) {
        if (adjustViewport) {
            fitMapToLatestLocations();
        }
        return;
    }

    state.historyLineLayer = L.layerGroup().addTo(state.map);
    state.historyLayer = L.layerGroup().addTo(state.map);
    state.historyMarkers = new Map();

    const grouped = new Map();
    records.slice().reverse().forEach((location) => {
        const key = location.user_id;
        if (!grouped.has(key)) {
            grouped.set(key, []);
        }
        grouped.get(key).push(location);
    });

    const boundsPoints = latestLocations.map((location) => mapLatLng(location));
    let selectedMarker = null;
    let selectedLatLng = null;

    for (const locations of grouped.values()) {
        const color = userColor(locations[0].user_id);
        const points = locations.map((location) => mapLatLng(location));
        boundsPoints.push(...points);

        if (points.length > 1) {
            L.polyline(points, {
                color,
                opacity: 0.62,
                weight: 3,
            }).addTo(state.historyLineLayer);
        }

        locations.forEach((location) => {
            const name = location.display_name || location.username;
            const popup = `${escapeHtml(name)}<br>${escapeHtml(location.role_label)}<br>${escapeHtml(location.created_at)}<br>${escapeHtml(formatCoord(location))}`;
            const selected = state.selectedHistoryId === location.id;
            const latLng = mapLatLng(location);

            const marker = L.marker(latLng, {
                icon: historyMarkerIcon(location, selected, color),
            }).bindPopup(popup);

            marker.on('click', () => selectHistory(location.id));
            marker.addTo(state.historyLayer);
            state.historyMarkers.set(location.id, marker);

            if (selected) {
                selectedMarker = marker;
                selectedLatLng = latLng;
            }
        });
    }

    if (adjustViewport && boundsPoints.length > 0) {
        state.map.fitBounds(L.latLngBounds(boundsPoints), {
            maxZoom: boundsPoints.length === 1 ? 16 : 15,
            padding: [28, 28],
        });
    }

    if (selectedMarker) {
        selectedMarker.openPopup();
    }

    if (adjustViewport && selectedLatLng) {
        state.map.setView(selectedLatLng, Math.max(state.map.getZoom(), 16), {
            animate: true,
        });
    }
}

function clearHistoryLayers() {
    if (state.historyLayer) {
        state.historyLayer.remove();
        state.historyLayer = null;
    }

    if (state.historyLineLayer) {
        state.historyLineLayer.remove();
        state.historyLineLayer = null;
    }

    state.historyMarkers = new Map();
}

function renderLocationCards(data) {
    renderMine(data.mine);
    if (data.mine && data.mine.address_diagnostics) {
        renderAddressDiagnostics(data.mine.address_diagnostics);
    }
    renderLocationList(el.monitorLocations, data.monitors || []);
    renderLocationList(el.guardianLocations, data.guardians || []);
}

function renderMine(location) {
    if (!location) {
        el.mineLocation.textContent = '暂无';
        el.mineTime.textContent = '更新时间：暂无';
        return;
    }

    el.mineLocation.textContent = formatCoord(location);
    el.mineTime.textContent = `更新时间：${location.updated_at}`;
}

function renderLocationList(container, locations) {
    const card = container.closest('.location-card');
    if (!locations.length) {
        if (card) {
            card.hidden = true;
        }
        container.replaceChildren();
        return;
    }

    if (card) {
        card.hidden = false;
    }

    container.replaceChildren(
        ...locations.map((location) => {
            const item = document.createElement('div');
            item.className = 'location-item';

            const name = document.createElement('div');
            name.className = 'location-name';
            name.textContent = location.display_name || location.username;

            const coord = document.createElement('div');
            coord.textContent = formatCoord(location);

            const time = document.createElement('div');
            time.textContent = `更新时间：${location.updated_at}`;

            item.append(name, coord, time);

            const statusText = locationAddressStatusText(location);
            if (statusText !== '位置信息一致或无法完整判断') {
                const mismatch = document.createElement('div');
                mismatch.textContent = statusText;
                item.append(mismatch);
            }

            return item;
        })
    );
}

function createAddressProbeSession(latitude, longitude) {
    const sourceTypes = ['gps', 'ip', 'webrtc'];
    const sources = new Map();
    const listeners = [];
    let completed = 0;

    pendingAddressSources(latitude, longitude).forEach((source) => {
        sources.set(source.type, source);
    });

    const current = () => normalizeAddressDiagnostics({
        mismatch: false,
        checked_at: new Date().toLocaleString('zh-CN', { hour12: false }),
        complete: completed >= sourceTypes.length,
        sources: sourceTypes.map((type) => sources.get(type)).filter(Boolean),
    });
    const publish = () => {
        const diagnostics = current();
        listeners.forEach((listener) => listener(diagnostics));
    };
    const watch = (type, promise) => {
        Promise.resolve(promise)
            .then((source) => {
                if (source) {
                    sources.set(type, source);
                }
            })
            .catch(() => {
                sources.set(type, {
                    ...sources.get(type),
                    address: '无法获取',
                    city: '',
                });
            })
            .finally(() => {
                completed += 1;
                publish();
            });
    };

    const updateSource = (type, source) => {
        if (!source) {
            return;
        }

        sources.set(type, source);
        publish();
    };

    watch('gps', reverseGpsAddress(latitude, longitude));
    watch('ip', probeIpAddress((source) => updateSource('ip', source)));
    watch('webrtc', probeWebRtcAddress());

    return {
        current,
        onUpdate(listener) {
            listeners.push(listener);
        },
    };
}

function pendingAddressSources(latitude, longitude) {
    return [{
        type: 'gps',
        name: '定位地址',
        address: `${latitude.toFixed(6)}, ${longitude.toFixed(6)} / 继续探测中`,
        city: '',
        latitude,
        longitude,
    }, {
        type: 'ip',
        name: 'IP 探测',
        address: '继续探测中',
        city: '',
    }, {
        type: 'webrtc',
        name: 'WebRTC 探测',
        address: '继续探测中',
        city: '',
    }];
}

function fallbackAddressDiagnostics(latitude, longitude) {
    return {
        mismatch: false,
        checked_at: new Date().toLocaleString('zh-CN', { hour12: false }),
        sources: [{
            type: 'gps',
            name: '定位地址',
            address: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
            city: '',
            latitude,
            longitude,
        }, {
            type: 'ip',
            name: 'IP 探测',
            address: '探测超时',
            city: '',
        }, {
            type: 'webrtc',
            name: 'WebRTC 探测',
            address: '探测超时',
            city: '',
        }],
    };
}

function withTimeout(promise, timeoutMs, fallback) {
    let timer = null;
    const timeout = new Promise((resolve) => {
        timer = window.setTimeout(() => resolve(fallback), timeoutMs);
    });

    return Promise.race([promise, timeout]).finally(() => {
        if (timer !== null) {
            window.clearTimeout(timer);
        }
    });
}

function fetchOpen(url, options = {}) {
    return fetch(url, {
        credentials: 'omit',
        ...options,
    });
}

async function fetchJsonOpen(url, options = {}) {
    const response = await fetchOpen(url, options);
    if (!response.ok) {
        throw new Error('request failed');
    }

    return response.json();
}

async function buildAddressDiagnostics(latitude, longitude) {
    const [gps, ip, webrtc] = await Promise.all([
        reverseGpsAddress(latitude, longitude),
        probeIpAddress(),
        probeWebRtcAddress(),
    ]);
    const sources = [gps, ip, webrtc].filter(Boolean);

    return normalizeAddressDiagnostics({
        mismatch: false,
        checked_at: new Date().toLocaleString('zh-CN', { hour12: false }),
        sources,
    });
}

async function reverseGpsAddress(latitude, longitude) {
    const fallback = {
        type: 'gps',
        name: '定位地址',
        address: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
        city: '',
        latitude,
        longitude,
    };

    return firstUsefulAddressResult([
        reverseGpsByBigDataCloud(latitude, longitude, fallback),
        reverseGpsByNominatim(latitude, longitude, fallback),
    ], fallback);
}

function firstUsefulAddressResult(promises, fallback) {
    return new Promise((resolve) => {
        let settled = false;
        let pending = promises.length;
        let fallbackResult = null;
        const finish = (result) => {
            if (settled) {
                return;
            }
            settled = true;
            resolve(result);
        };

        promises.forEach((promise) => {
            Promise.resolve(promise)
                .then((result) => {
                    if (settled) {
                        return;
                    }

                    if (result && (result.city || result.address !== fallback.address)) {
                        finish(result);
                        return;
                    }

                    fallbackResult = fallbackResult || result;
                })
                .catch(() => {
                    // Try the other reverse-geocode source.
                })
                .finally(() => {
                    pending -= 1;
                    if (!settled && pending === 0) {
                        finish(fallbackResult || fallback);
                    }
                });
        });
    });
}

async function reverseGpsByBigDataCloud(latitude, longitude, fallback) {
    try {
        const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&localityLanguage=zh`;
        const data = await fetchJsonOpen(url);
        const administrative = data.localityInfo && Array.isArray(data.localityInfo.administrative)
            ? data.localityInfo.administrative
            : [];
        const informative = data.localityInfo && Array.isArray(data.localityInfo.informative)
            ? data.localityInfo.informative
            : [];
        const city = data.city || data.locality || data.principalSubdivision || inferCityFromText(administrative.map((item) => item.name).join(' '));
        const parts = [
            data.countryName,
            data.principalSubdivision,
            data.city || data.locality,
            informative[0] ? informative[0].name : '',
        ].filter(Boolean);

        return {
            ...fallback,
            address: parts.length ? parts.join(' ') : fallback.address,
            city: city || inferCityFromText(parts.join(' ')),
            region: data.principalSubdivision || '',
            country: data.countryName || '',
        };
    } catch (error) {
        return fallback;
    }
}

async function reverseGpsByNominatim(latitude, longitude, fallback) {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}&accept-language=zh-CN`;
        const response = await fetchOpen(url, { credentials: 'omit' });
        const data = await response.json();
        const address = data.address || {};
        const displayName = data.display_name || '';
        const city = address.city
            || address.town
            || address.village
            || address.municipality
            || address.county
            || address.district
            || address.state_district
            || address.state
            || address.province
            || inferCityFromText(displayName);

        return {
            ...fallback,
            address: displayName || fallback.address,
            city,
            region: address.state || address.province || '',
            country: address.country || '',
        };
    } catch (error) {
        return fallback;
    }
}

function renderAddressDiagnostics(diagnostics) {
    const normalized = normalizeAddressDiagnostics(diagnostics);
    state.addressDiagnostics = normalized;

    if (!el.addressDiagnostics) {
        return;
    }

    if (!normalized || !Array.isArray(normalized.sources)) {
        el.addressDiagnostics.textContent = '等待上报后显示';
        return;
    }

    const alert = document.createElement('div');
    alert.className = `address-alert ${normalized.mismatch ? 'warn' : 'ok'}`;
    alert.textContent = addressDiagnosticsStatusText(normalized);

    const rows = normalized.sources.map((source) => {
        const row = document.createElement('div');
        row.className = 'address-row';

        const title = document.createElement('div');
        title.className = 'address-name';
        title.textContent = source.name || source.type || '地址';

        const address = document.createElement('div');
        address.textContent = source.address || source.ip || '未知';

        const city = document.createElement('div');
        city.textContent = `城市：${cityDisplayName(source.city || inferCityFromText(source.address || '')) || '未知'}`;

        row.append(title, address, city);
        if (source.mobile_network_uncertain) {
            const note = document.createElement('div');
            note.className = 'address-note';
            note.textContent = '移动网络出口省份不一致';
            row.append(note);
        }
        return row;
    });

    el.addressDiagnostics.replaceChildren(alert, ...rows);
}

function locationDisplayCoordinates(location) {
    const preferredSource = preferredMapSource(location);
    const preferredCoordinates = sourceCoordinates(preferredSource);
    if (preferredCoordinates) {
        return {
            ...preferredCoordinates,
            source: preferredSource,
        };
    }

    return {
        latitude: Number(location.latitude),
        longitude: Number(location.longitude),
        source: null,
    };
}

function formatCoord(location) {
    const coordinates = locationDisplayCoordinates(location);
    const sourceLabel = coordinates.source ? ` / ${coordinates.source.name || '探测位置'}` : '';
    const accuracy = !coordinates.source && location.accuracy !== null ? ` / 精度 ${Math.round(location.accuracy)}m` : '';
    return `${coordinates.latitude.toFixed(6)}, ${coordinates.longitude.toFixed(6)}${sourceLabel}${accuracy}`;
}

function renderMarkers(locations) {
    if (!state.map) {
        return;
    }

    const activeIds = new Set();

    locations.forEach((location) => {
        activeIds.add(location.user_id);
        const key = location.user_id;
        const latLng = mapLatLng(location);
        const name = location.display_name || location.username;
        const popup = `${escapeHtml(name)}<br>${escapeHtml(location.role_label)}<br>${escapeHtml(location.updated_at)}`;
        const color = userColor(location.user_id);
        const iconHtml = `<div class="marker-dot ${location.role}" style="--marker-color: ${escapeHtml(color)}">${escapeHtml(markerInitial(location))}</div>`;

        if (state.markers.has(key)) {
            state.markers.get(key)
                .setLatLng(latLng)
                .setPopupContent(popup)
                .setIcon(latestMarkerIcon(location, iconHtml));
            return;
        }

        const marker = L.marker(latLng, {
            icon: latestMarkerIcon(location, iconHtml),
        }).bindPopup(popup);

        marker.addTo(state.map);
        state.markers.set(key, marker);
    });

    for (const [key, marker] of state.markers.entries()) {
        if (!activeIds.has(key)) {
            marker.remove();
            state.markers.delete(key);
        }
    }

    el.mapEmpty.hidden = locations.length > 0 || state.history.length > 0;

    if (locations.length > 0 && state.history.length === 0) {
        fitMapToLatestLocations();
    }
}

function latestMarkerIcon(location, html = '') {
    return L.divIcon({
        className: '',
        html: html || `<div class="marker-dot ${location.role}" style="--marker-color: ${escapeHtml(userColor(location.user_id))}">${escapeHtml(markerInitial(location))}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
    });
}

function historyMarkerIcon(location, selected = false, color = userColor(location.user_id)) {
    const size = selected ? 30 : 22;
    return L.divIcon({
        className: '',
        html: `<div class="history-map-dot${selected ? ' selected' : ''}" style="--marker-color: ${escapeHtml(color)}">${escapeHtml(markerInitial(location))}</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
    });
}

function markerInitial(location) {
    const name = String(location.display_name || location.username || '').trim();
    const chars = Array.from(name);
    return chars[0] || '位';
}

function fitMapToLatestLocations() {
    const locations = visibleLatestLocations();
    if (!state.map || typeof L === 'undefined' || !locations.length) {
        return;
    }

    const points = locations.map((location) => mapLatLng(location));
    state.map.fitBounds(L.latLngBounds(points), {
        maxZoom: points.length === 1 ? 16 : 15,
        padding: [34, 34],
    });
}

function visibleLatestLocations() {
    if (!state.historyUserId) {
        return state.lastLocations;
    }

    return state.lastLocations.filter((location) => String(location.user_id) === String(state.historyUserId));
}

function userColor(userId) {
    const numeric = Math.abs(Number(userId) || 0);
    return USER_COLORS[numeric % USER_COLORS.length];
}

function mapLatLng(location) {
    const coordinates = locationDisplayCoordinates(location);
    const converted = wgs84ToGcj02(coordinates.longitude, coordinates.latitude);
    return [converted.lat, converted.lng];
}

function wgs84ToGcj02(lng, lat) {
    if (outOfChina(lng, lat)) {
        return { lng, lat };
    }

    let dLat = transformLat(lng - 105.0, lat - 35.0);
    let dLng = transformLng(lng - 105.0, lat - 35.0);
    const radLat = lat / 180.0 * Math.PI;
    let magic = Math.sin(radLat);
    magic = 1 - 0.00669342162296594323 * magic * magic;
    const sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180.0) / ((6335552.717000426 / (magic * sqrtMagic)) * Math.PI);
    dLng = (dLng * 180.0) / ((6378245.0 / sqrtMagic) * Math.cos(radLat) * Math.PI);
    return {
        lng: lng + dLng,
        lat: lat + dLat,
    };
}

function outOfChina(lng, lat) {
    return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x, y) {
    let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
    ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
    return ret;
}

function transformLng(x, y) {
    let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
    ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
    return ret;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

if (el.termsButton) {
    el.termsButton.addEventListener('click', () => showDocumentPopup('用户协议', window.USER_AGREEMENT_SECTIONS || []));
}
if (el.privacyButton) {
    el.privacyButton.addEventListener('click', () => showDocumentPopup('隐私条约', window.PRIVACY_POLICY_SECTIONS || []));
}
if (el.settingsButton) {
    el.settingsButton.addEventListener('click', openSettingsPopup);
}

el.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    el.loginMessage.hidden = true;

    try {
        const payload = await api('login', {
            method: 'POST',
            body: JSON.stringify({
                username: el.username.value,
                password: el.password.value,
                terms_accepted: !!(el.termsAccepted && el.termsAccepted.checked),
            }),
        });

        el.password.value = '';
        if (payload.redirect) {
            window.location.href = payload.redirect;
            return;
        }

        showMain(payload.user);
    } catch (error) {
        el.loginMessage.textContent = error.message;
        el.loginMessage.hidden = false;
    }
});

el.logoutButton.addEventListener('click', async () => {
    try {
        await api('logout', { method: 'POST' });
    } finally {
        showLogin();
    }
});

el.reportButton.addEventListener('click', manualReport);
el.continuousReportButton.addEventListener('click', toggleGuardianContinuousReport);
el.groupSelect.addEventListener('change', () => applySelectedGroup(el.groupSelect.value, true));
el.historyRefreshButton.addEventListener('click', refreshHistory);
el.historyUserFilter.addEventListener('change', changeHistoryUserFilter);
el.historyPageSize.addEventListener('change', changeHistoryPageSize);
el.historyMapPageSize.addEventListener('change', changeHistoryMapPageSize);
el.historyPrevButton.addEventListener('click', () => changeHistoryPage(-1));
el.historyNextButton.addEventListener('click', () => changeHistoryPage(1));
if (el.themeMode) {
    el.themeMode.addEventListener('change', () => applyThemeMode(el.themeMode.value));
}

window.addEventListener('online', () => {
    refreshLocations();
    refreshHistory();
});
window.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.user) {
        refreshLocations();
        refreshHistory();
    }
});

initThemeMode();
if (typeof startWebVersionWatcher === 'function') {
    startWebVersionWatcher();
}

(async function boot() {
    try {
        const payload = await api('me');
        setReportInterval(payload.report_interval_seconds);
        if (payload.user) {
            showMain(payload.user);
        } else {
            showLogin();
        }
    } catch (error) {
        showLogin(error.message);
    }
})();
