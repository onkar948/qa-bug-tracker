// ============================================================
// POC Test Tracker — Firebase Cloud Version
// ============================================================

// =============================================
// 🔥 FIREBASE CONFIG
// =============================================
// const firebaseConfig = {
//     apiKey: "AIzaSyBYhQsnq3fLPlLjYNNHuftuZDd3BUAwOYg",
//     authDomain: "poc-tracker-46580.firebaseapp.com",
//     projectId: "poc-tracker-46580",
//     storageBucket: "poc-tracker-46580.firebasestorage.app",
//     messagingSenderId: "568469845077",
//     appId: "1:568469845077:web:f80225c4a1bd6e640a10dc",
//     measurementId: "G-HM82QL40RG"
// };

const firebaseConfig = {
  apiKey: "AIzaSyDewz5leNUAHLAL0_6rS0H2EHv58uRV20U",
  authDomain: "qa-bug-tracker-b1d32.firebaseapp.com",
  projectId: "qa-bug-tracker-b1d32",
  storageBucket: "qa-bug-tracker-b1d32.firebasestorage.app",
  messagingSenderId: "877599639764",
  appId: "1:877599639764:web:385ff8dd00de26e43bd341",
  measurementId: "G-162QNWW0Z3"
}
// ---------- Firebase Init ----------
firebase.initializeApp(firebaseConfig);
const firestore = firebase.firestore();
const firebaseAuth = firebase.auth();
const DB_DOC = firestore.collection('pocTracker').doc('mainData');
const TRACKER_ADMIN_EMAIL = 'onkar.joshi@infoteksoftware.com';

// ---------- State ----------
let db = { customers: [] };
let currentCustomerId = null;
let currentPocId = null;
let modalCallback = null;
let isLoading = true;
let isAdmin = false;
let activeCustomerKey = null;
let tableScrollSyncing = false;
let tableScrollProxyInitialized = false;
let dashboardFeatureFilter = null;
let dashboardCustomerFilter = 'all';
let cloudUnsubscribe = null;
let hasUnrecognizedCloudData = false;

const DEFAULT_TEST_COLUMNS = [
    'Sr. No.', 'Module', 'Scenario', 'Execution Step',
    'Expected Behavior', 'Actual Behavior', 'Comment', 'Status'
];
const FINAL_TEST_STATUSES = ['Pass', 'Fail', 'Partially Pass', 'Blocked', 'Not Applicable'];
const RESULT_TEST_STATUSES = ['Pass', 'Fail', 'Partially Pass', 'Blocked'];

function normalizeHeader(header) {
    return String(header || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getColumnKind(header) {
    const key = normalizeHeader(header);
    if (['srno', 'serialno', 'serialnumber', 'testno', 'testnumber'].includes(key)) return 'testNo';
    if (key === 'status' || key === 'teststatus') return 'status';
    if (['module', 'component', 'feature', 'area'].some(term => key.includes(term))) return 'module';
    if (['scenario', 'testcase', 'description', 'title', 'name'].some(term => key.includes(term))) return 'scenario';
    if (['executionstep', 'execstep', 'procedure', 'action', 'steps'].some(term => key.includes(term))) return 'execStep';
    if (['expectedbehavior', 'expectedresult', 'expected', 'expect'].some(term => key.includes(term))) return 'expectedBehavior';
    if (['actualbehavior', 'actualresult', 'actual', 'observed'].some(term => key.includes(term))) return 'actualBehavior';
    if (['comment', 'note', 'remark', 'observation'].some(term => key.includes(term))) return 'comment';
    return null;
}

function findImportHeaderRow(rows) {
    const searchLimit = Math.min(rows.length, 20);
    for (let rowIndex = 0; rowIndex < searchLimit; rowIndex++) {
        const headers = (rows[rowIndex] || []).map(value => String(value ?? '').trim());
        const nonEmptyHeaders = headers.filter(Boolean);
        const hasStatus = nonEmptyHeaders.some(header => getColumnKind(header) === 'status');
        const hasTestCaseField = nonEmptyHeaders.some(header => {
            const kind = getColumnKind(header);
            return kind && kind !== 'status';
        });
        if (hasStatus && hasTestCaseField) return { rowIndex, headers };
    }
    return null;
}

function getPocColumns(poc) {
    return Array.isArray(poc.columns) && poc.columns.length ? poc.columns : DEFAULT_TEST_COLUMNS;
}

function getTestCaseValue(testCase, header) {
    const kind = getColumnKind(header);
    if (kind === 'status') return testCase.status || (testCase.values && testCase.values[header]) || 'Not Executed';
    if (kind === 'testNo') return testCase.testNo ?? (testCase.values && testCase.values[header]) ?? '';
    if (testCase.values && Object.prototype.hasOwnProperty.call(testCase.values, header)) {
        return testCase.values[header];
    }
    return kind ? (testCase[kind] ?? '') : '';
}

function getFeatureName(testCase, columns) {
    const featureColumn = columns.find(column => getColumnKind(column) === 'module');
    return String(featureColumn ? getTestCaseValue(testCase, featureColumn) : testCase.module || '').trim() || 'Unassigned';
}

function isFinalTestStatus(status) {
    return FINAL_TEST_STATUSES.includes(status);
}

function hasTestCaseResults(testCase, columns) {
    const expectedColumn = columns.find(column => getColumnKind(column) === 'expectedBehavior');
    const actualColumn = columns.find(column => getColumnKind(column) === 'actualBehavior');
    return Boolean(
        expectedColumn &&
        actualColumn &&
        String(getTestCaseValue(testCase, expectedColumn) ?? '').trim() &&
        String(getTestCaseValue(testCase, actualColumn) ?? '').trim()
    );
}

function updateExecutionState(poc) {
    if (!poc.executionStartedAt) return;
    const complete = poc.testCases.length > 0 && poc.testCases.every(testCase => isFinalTestStatus(testCase.status));
    poc.executionStatus = complete ? 'Completed' : 'In Progress';
    poc.executionCompletedAt = complete ? (poc.executionCompletedAt || new Date().toISOString()) : null;
}

function getFeatureExecutionState(feature) {
    if (!feature.executionStartedAt) return 'not-tested';
    const complete = feature.testCases.length > 0 && feature.testCases.every(testCase => isFinalTestStatus(testCase.status));
    return complete ? 'completed' : 'under-test';
}

// ---------- Multi-Tenancy & Privacy (Customer Isolation) ----------
function detectCustomerFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    const key = urlParams.get('c') || urlParams.get('customer') || urlParams.get('client');
    if (key) {
        activeCustomerKey = key.trim();
    }
}

function ensureCustomerAccessKeys() {
    let changed = false;
    db.customers.forEach(c => {
        if (!c.accessKey) {
            const slug = (c.name || 'client').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'client';
            c.accessKey = slug + '_' + Math.random().toString(36).substring(2, 7);
            changed = true;
        }
    });
    if (changed) {
        saveData();
    }
}

function getVisibleCustomers() {
    if (isAdmin) {
        return db.customers;
    }
    if (activeCustomerKey) {
        return db.customers.filter(c => c.accessKey === activeCustomerKey || c.id === activeCustomerKey);
    }
    return [];
}

function getShareableLink(customer) {
    const base = window.location.origin + window.location.pathname;
    return `${base}?c=${customer.accessKey}`;
}

function copyCustomerLink(customerId) {
    const cust = getCustomer(customerId);
    if (!cust) return;
    const link = getShareableLink(cust);
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(() => {
            toast(`Private link copied for ${cust.name}! Competitors cannot see this.`, 'success');
        }).catch(() => {
            prompt('Copy this feature link:', link);
        });
    } else {
        prompt('Copy this feature link:', link);
    }
}

function copyCurrentCustomerLink() {
    if (currentCustomerId) {
        copyCustomerLink(currentCustomerId);
    }
}

function submitAccessCode() {
    const input = document.getElementById('manualAccessCodeInput');
    if (!input || !input.value.trim()) return;
    const code = input.value.trim();

    // Check if user entered a Feature Access Code.
    const found = db.customers.find(c => c.accessKey === code || c.id === code || (c.name && c.name.toLowerCase() === code.toLowerCase()));
    if (found) {
        activeCustomerKey = found.accessKey;
        const newUrl = window.location.pathname + '?c=' + found.accessKey;
        window.history.pushState({}, '', newUrl);
        input.value = '';
        refreshCurrentView();
        toast(`Welcome, ${found.name}!`, 'success');
    } else {
        toast('Invalid code or password. Please try again.', 'error');
    }
}

// ---------- Admin Access ----------
function toggleAdminMode() {
    if (!isAuthorizedTrackerAdmin(firebaseAuth.currentUser)) {
        toast('Admin access is available only to the authorized signed-in account.', 'error');
        return;
    }
    isAdmin = !isAdmin;
    updateAdminUI();
    refreshCurrentView();
    toast(isAdmin ? 'Admin mode activated.' : 'Admin mode deactivated.', 'info');
}

function isAuthorizedTrackerAdmin(user) {
    return Boolean(user && user.emailVerified && user.email
        && user.email.toLowerCase() === TRACKER_ADMIN_EMAIL);
}

function updateAdminUI() {
    const adminControls = document.getElementById('adminControls');
    const adminToggleBtn = document.getElementById('adminToggleBtn');
    const adminToggleIcon = document.getElementById('adminToggleIcon');
    const adminToggleText = document.getElementById('adminToggleText');
    const sidebarAddCustBtn = document.getElementById('sidebarAddCustBtn');
    const customerAdminActions = document.getElementById('customerAdminActions');
    const pocAdminActions = document.getElementById('pocAdminActions');
    const columnAdminActions = document.getElementById('columnAdminActions');

    if (adminControls) adminControls.style.display = isAdmin ? 'flex' : 'none';
    if (sidebarAddCustBtn) sidebarAddCustBtn.style.display = isAdmin ? 'inline-flex' : 'none';
    if (customerAdminActions) customerAdminActions.style.display = isAdmin ? 'flex' : 'none';
    if (pocAdminActions) pocAdminActions.style.display = isAdmin ? 'flex' : 'none';
    if (columnAdminActions) columnAdminActions.style.display = isAdmin ? 'flex' : 'none';

    if (adminToggleBtn) {
        if (isAdmin) {
            // Green when active
            adminToggleBtn.className = 'btn btn-success';
            adminToggleBtn.title = 'Admin Active (Click to deactivate)';
            if (adminToggleIcon) adminToggleIcon.className = 'fas fa-lock-open';
            if (adminToggleText) adminToggleText.textContent = 'Admin Active';
        } else {
            // Normal color when inactive
            adminToggleBtn.className = 'btn btn-outline';
            adminToggleBtn.title = 'Click to activate Admin Mode';
            if (adminToggleIcon) adminToggleIcon.className = 'fas fa-lock';
            if (adminToggleText) adminToggleText.textContent = 'Admin';
        }
    }

    // Re-render table if in POC view to toggle Actions column & delete buttons
    if (currentPocId && currentCustomerId) {
        renderTestCases();
    }
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', () => {
    detectCustomerFromURL();
    const signInForm = document.getElementById('signInForm');
    if (signInForm) signInForm.addEventListener('submit', signInToCloud);

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('demo') === '1' || urlParams.get('demo') === '2') {
        db = {
            customers: [{
                id: 'c1',
                name: 'Acme Corp',
                accessKey: 'acme-corp_8x2a1',
                pocs: [{
                    id: 'p1',
                    name: 'Login Module Feature',
                    testCases: [
                        { id: 't1', testNo: 1, module: 'Authentication', scenario: 'Login with valid credentials', execStep: '1. Open app\n2. Enter valid username\n3. Enter valid password\n4. Click Login', expectedBehavior: 'User should be redirected to dashboard', actualBehavior: 'User redirected to dashboard', comment: 'Verified on Chrome v120', status: 'Pass' },
                        { id: 't2', testNo: 2, module: 'Authentication', scenario: 'Login with invalid password', execStep: '1. Open app\n2. Enter valid username\n3. Enter wrong password\n4. Click Login', expectedBehavior: 'Error message: Invalid credentials', actualBehavior: 'Shows error alert', comment: '', status: 'Pass' },
                        { id: 't3', testNo: 3, module: 'Authentication', scenario: 'Forgot password flow', execStep: '1. Click Forgot Password\n2. Enter registered email\n3. Click Submit', expectedBehavior: 'Password reset email should be sent', actualBehavior: '', comment: '', status: 'In Progress' },
                        { id: 't4', testNo: 4, module: 'Authentication', scenario: 'Session timeout after 30 min', execStep: '1. Login successfully\n2. Wait 30 minutes idle\n3. Try to navigate', expectedBehavior: 'User should be redirected to login page', actualBehavior: 'Token refreshed instead', comment: 'Check session timeout config', status: 'Fail' }
                    ]
                }]
            }, {
                id: 'c2',
                name: 'Stark Industries',
                accessKey: 'stark-ind_9z7c3',
                pocs: [{
                    id: 'p2',
                    name: 'Security Feature',
                    testCases: []
                }]
            }]
        };
        isLoading = false;
        isAdmin = urlParams.get('admin') === '1';
        document.body.classList.remove('signed-out');
        document.getElementById('authView').hidden = true;
        renderSidebar();
        if (urlParams.get('demo') === '2') {
            showDashboard();
        } else {
            showCustomer('c1');
        }
        updateAdminUI();
        return;
    }

    firebaseAuth.onAuthStateChanged((user) => {
        const authView = document.getElementById('authView');
        const signOutBtn = document.getElementById('signOutBtn');
        if (!user) {
            if (cloudUnsubscribe) {
                cloudUnsubscribe();
                cloudUnsubscribe = null;
            }
            db = { customers: [] };
            isAdmin = false;
            document.body.classList.add('signed-out');
            if (authView) authView.hidden = false;
            if (signOutBtn) signOutBtn.hidden = true;
            isLoading = true;
            return;
        }

        if (!user.emailVerified) {
            isAdmin = false;
            document.body.classList.add('signed-out');
            if (authView) authView.hidden = false;
            if (signOutBtn) signOutBtn.hidden = true;
            showAuthError('Verify your email address before accessing cloud data.');
            isLoading = true;
            return;
        }

        isAdmin = isAuthorizedTrackerAdmin(user);
        if (isAdmin) {
            activeCustomerKey = null;
        }
        document.body.classList.remove('signed-out');
        if (authView) authView.hidden = true;
        if (signOutBtn) signOutBtn.hidden = false;
        updateAdminUI();
        loadDataFromCloud();
    }, (error) => {
        console.error('Firebase authentication state error:', error);
        showAuthError(error.message);
    });
});

async function signInToCloud(event) {
    event.preventDefault();
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const signInBtn = document.getElementById('signInBtn');
    showAuthError('');
    signInBtn.disabled = true;
    try {
        const credential = await firebaseAuth.signInWithEmailAndPassword(email, password);
        if (!credential.user.emailVerified) {
            await credential.user.sendEmailVerification();
            await firebaseAuth.signOut();
            showAuthError('A verification link was sent to your email. Verify it, then sign in again.');
        }
    } catch (error) {
        console.error('Firebase sign-in error:', error);
        showAuthError(error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found'
            ? 'Email or password is incorrect.'
            : error.message);
    } finally {
        signInBtn.disabled = false;
    }
}

function showAuthError(message) {
    const errorElement = document.getElementById('authError');
    if (!errorElement) return;
    errorElement.textContent = message;
    errorElement.hidden = !message;
}

async function signOutOfCloud() {
    try {
        await firebaseAuth.signOut();
    } catch (error) {
        console.error('Firebase sign-out error:', error);
        toast('Unable to sign out: ' + error.message, 'error');
    }
}

// ============================================================
// DATA PERSISTENCE (Firebase Firestore)
// ============================================================
function loadDataFromCloud() {
    if (cloudUnsubscribe) cloudUnsubscribe();
    // Real-time listener: auto-syncs when anyone makes changes
    cloudUnsubscribe = DB_DOC.onSnapshot((doc) => {
        if (doc.exists) {
            const cloudData = doc.data();
            const rawCustomers = Array.isArray(cloudData.customers)
                ? cloudData.customers
                : cloudData.id || cloudData.pocs
                    ? [cloudData]
                    : null;
            if (!rawCustomers) {
                console.error('Unexpected Firestore data shape:', cloudData);
                toast('Cloud data was found, but its format is not recognized. No data was changed.', 'error');
                isLoading = false;
                refreshCurrentView();
                return;
            }

            const normalized = normalizeCloudCustomers(rawCustomers);
            if (normalized.customers.length === 0 && rawCustomers.some(value => String(value ?? '').trim())) {
                console.error('Firestore customer entries could not be normalized:', cloudData);
                hasUnrecognizedCloudData = true;
                toast('Cloud data was found, but its feature entries could not be read. No data was changed.', 'error');
                isLoading = false;
                refreshCurrentView();
                return;
            }
            db = { ...cloudData, customers: normalized.customers };
            hasUnrecognizedCloudData = normalized.ignoredEntries > 0;
            if (normalized.ignoredEntries > 0) {
                console.warn(`Found ${normalized.ignoredEntries} unrecognized non-empty Firestore entr${normalized.ignoredEntries === 1 ? 'y' : 'ies'}. Cloud writes are paused to protect the original data.`);
                toast('Some saved cloud entries could not be read. Cloud writes are paused to protect your data.', 'error');
            } else {
                hasUnrecognizedCloudData = false;
            }
        } else {
            hasUnrecognizedCloudData = false;
            db = { customers: [] };
            DB_DOC.set(db).catch(e => {
                console.error('Firestore initialization error:', e);
                toast(getCloudPermissionMessage(e, 'Unable to initialize cloud data.'), 'error');
            });
        }
        isLoading = false;
        refreshCurrentView();
    }, (error) => {
        console.error('Firebase snapshot error:', error);
        toast(getCloudPermissionMessage(error, 'Cloud sync notice: ' + error.message), 'error');
        // Fallback to localStorage if offline
        const stored = localStorage.getItem('pocTestTracker');
        if (stored) {
            try { db = JSON.parse(stored); } catch (e) { db = { customers: [] }; }
        }
        isLoading = false;
        refreshCurrentView();
    });
}

function normalizeCloudCustomers(rawCustomers) {
    const customers = [];
    let ignoredEntries = 0;

    rawCustomers.forEach((rawCustomer, customerIndex) => {
        const customer = parseCloudValue(rawCustomer);
        if (!customer || typeof customer !== 'object' || Array.isArray(customer) || !Array.isArray(customer.pocs)) {
            if (String(rawCustomer ?? '').trim()) ignoredEntries++;
            return;
        }

        const pocs = [];
        customer.pocs.forEach((rawPoc, pocIndex) => {
            const poc = parseCloudValue(rawPoc);
            if (!poc || typeof poc !== 'object' || Array.isArray(poc)) {
                if (String(rawPoc ?? '').trim()) ignoredEntries++;
                return;
            }

            const testCases = [];
            if (Array.isArray(poc.testCases)) {
                poc.testCases.forEach(rawTestCase => {
                    const testCase = parseCloudValue(rawTestCase);
                    if (testCase && typeof testCase === 'object' && !Array.isArray(testCase)) {
                        testCases.push(testCase);
                    } else if (String(rawTestCase ?? '').trim()) {
                        ignoredEntries++;
                    }
                });
            }
            pocs.push({
                ...poc,
                id: poc.id ? String(poc.id) : genId(),
                name: String(poc.name || poc.moduleName || `Module ${pocIndex + 1}`),
                columns: Array.isArray(poc.columns) ? poc.columns : [],
                testCases
            });
        });

        customers.push({
            ...customer,
            id: customer.id ? String(customer.id) : genId(),
            name: String(customer.name || customer.customerName || customer.featureName || `Imported Feature ${customerIndex + 1}`),
            pocs
        });
    });

    return { customers, ignoredEntries };
}

function parseCloudValue(value) {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
        return JSON.parse(trimmed);
    } catch (error) {
        return null;
    }
}

function getCloudPermissionMessage(error, fallback) {
    if (error && (error.code === 'permission-denied' || error.code === 'firestore/permission-denied')) {
        return 'Cloud access denied. Sign in with an authorized account and publish the Firestore rules from firestore.rules.';
    }
    return fallback;
}

function saveData() {
    // Save to Firestore
    if (!firebaseAuth.currentUser) {
        localStorage.setItem('pocTestTracker', JSON.stringify(db));
        toast('Sign in to sync changes to the cloud.', 'error');
        return;
    }
    if (hasUnrecognizedCloudData) {
        localStorage.setItem('pocTestTracker', JSON.stringify(db));
        toast('Cloud save paused to protect entries that could not be read. Correct the Firestore data format before saving.', 'error');
        return;
    }
    DB_DOC.set(JSON.parse(JSON.stringify(db))).catch(err => {
        console.error('Save error:', err);
        toast(getCloudPermissionMessage(err, 'Error saving to cloud: ' + err.message), 'error');
    });
    // Also backup locally
    localStorage.setItem('pocTestTracker', JSON.stringify(db));
}

function refreshCurrentView() {
    ensureCustomerAccessKeys();

    if (!isAdmin && !activeCustomerKey) {
        // Visitor is not Admin and has no client link: show secure portal landing
        showView('portalLandingView');
        renderSidebar();
        return;
    }

    if (!isAdmin && activeCustomerKey) {
        // Customer viewing their private space
        const visible = getVisibleCustomers();
        if (visible.length === 0) {
            toast('Invalid or expired customer access link.', 'error');
            showView('portalLandingView');
            renderSidebar();
            return;
        }
        renderSidebar();
        const myCust = visible[0];
        if (currentPocId && currentCustomerId === myCust.id) {
            showPoc(myCust.id, currentPocId);
        } else {
            showCustomer(myCust.id);
        }
        return;
    }

    // Admin view
    renderSidebar();
    if (currentPocId && currentCustomerId) {
        const poc = getPoc(currentCustomerId, currentPocId);
        if (poc) {
            showPoc(currentCustomerId, currentPocId);
        } else {
            showCustomer(currentCustomerId);
        }
    } else if (currentCustomerId) {
        const customer = getCustomer(currentCustomerId);
        if (customer) {
            showCustomer(currentCustomerId);
        } else {
            showDashboard();
        }
    } else {
        showDashboard();
    }
}

// ============================================================
// NAVIGATION
// ============================================================
function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const el = document.getElementById(viewId);
    if (el) el.classList.add('active');
    requestAnimationFrame(syncTestTableScrollProxy);
}

function showDashboard() {
    dashboardFeatureFilter = null;
    if (!isAdmin && !activeCustomerKey) {
        showView('portalLandingView');
        highlightActiveNav();
        updateAdminUI();
        return;
    }
    if (!isAdmin && activeCustomerKey) {
        const visible = getVisibleCustomers();
        if (visible.length > 0) {
            showCustomer(visible[0].id);
            return;
        }
    }
    currentCustomerId = null;
    currentPocId = null;
    showView('dashboardView');
    renderDashboard();
    highlightActiveNav();
    updateAdminUI();
}

function showCustomer(customerId) {
    const visible = getVisibleCustomers();
    const customer = visible.find(c => c.id === customerId);
    if (!customer) {
        showDashboard();
        return;
    }
    currentCustomerId = customerId;
    currentPocId = null;
    document.getElementById('customerTitle').textContent = customer.name;

    // Show/hide Link Bar for Admin
    const linkBar = document.getElementById('customerLinkBar');
    const linkText = document.getElementById('customerLinkText');
    if (linkBar && linkText) {
        if (isAdmin) {
            linkText.textContent = getShareableLink(customer);
            linkBar.style.display = 'flex';
        } else {
            linkBar.style.display = 'none';
        }
    }

    showView('customerView');
    renderPocGrid();
    highlightActiveNav();
    updateAdminUI();
}

function showPoc(customerId, pocId) {
    currentCustomerId = customerId;
    currentPocId = pocId;
    const customer = getCustomer(customerId);
    const poc = getPoc(customerId, pocId);
    if (!customer || !poc) return;
    document.getElementById('pocTitle').textContent = `${customer.name} → ${poc.name}`;
    showView('pocView');
    populateModuleFilter();
    renderTestCases();
    highlightActiveNav();
    updateAdminUI();
}

function highlightActiveNav() {
    const dashBtn = document.getElementById('navDashboardBtn');
    if (dashBtn) {
        dashBtn.classList.toggle('active', currentCustomerId === null);
    }
    document.querySelectorAll('.customer-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.id === currentCustomerId);
    });
}

// ============================================================
// HELPERS
// ============================================================
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function getCustomer(id) { return db.customers.find(c => c.id === id); }

function getPoc(customerId, pocId) {
    const c = getCustomer(customerId);
    return c ? c.pocs.find(p => p.id === pocId) : null;
}

function getTestCaseStats(testCases) {
    const stats = { total: testCases.length, Pass: 0, Fail: 0, 'Partially Pass': 0, Blocked: 0, 'In Progress': 0, 'Not Executed': 0, 'Not Applicable': 0 };
    testCases.forEach(tc => { if (stats[tc.status] !== undefined) stats[tc.status]++; });
    return stats;
}

// ============================================================
// RENDER: SIDEBAR
// ============================================================
function renderSidebar() {
    const list = document.getElementById('customerList');
    const visible = getVisibleCustomers();
    if (visible.length === 0) {
        list.innerHTML = '<p style="padding:16px;color:var(--gray-400);font-size:13px;text-align:center;">No features available</p>';
        return;
    }
    list.innerHTML = visible.map(c => `
        <div class="customer-item">
            <button class="customer-btn ${c.id === currentCustomerId ? 'active' : ''}" 
                    data-id="${c.id}" onclick="showCustomer('${c.id}')">
                <i class="fas fa-building"></i>
                <span>${escHtml(c.name)}</span>
                <span class="count">${c.pocs.length} Module${c.pocs.length !== 1 ? 's' : ''}</span>
            </button>
        </div>
    `).join('');
}

// ============================================================
// RENDER: DASHBOARD
// ============================================================
function showDashboardFeatureFilter(state) {
    dashboardFeatureFilter = dashboardFeatureFilter === state ? null : state;
    renderDashboard();
    const section = document.getElementById('dashboardFeatureStatusSection');
    if (dashboardFeatureFilter && section) section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearDashboardFeatureFilter() {
    dashboardFeatureFilter = null;
    renderDashboard();
}

function setDashboardCustomerFilter(customerId) {
    dashboardCustomerFilter = customerId;
    renderDashboard();
}

function renderDashboardFeatureFilter(features) {
    const section = document.getElementById('dashboardFeatureStatusSection');
    const title = document.getElementById('dashboardFeatureStatusTitle');
    const grid = document.getElementById('dashboardFeatureStatusGrid');
    if (!section || !title || !grid) return;
    if (!dashboardFeatureFilter) {
        section.style.display = 'none';
        grid.innerHTML = '';
        return;
    }

    const labels = {
        'under-test': 'Modules Under Test',
        'not-tested': 'Modules Not Tested',
        completed: 'Completed Modules'
    };
    const matched = features.filter(feature => feature.state === dashboardFeatureFilter);
    const customerGroups = new Map();
    matched.forEach(feature => {
        if (!customerGroups.has(feature.customerId)) {
            customerGroups.set(feature.customerId, {
                customerId: feature.customerId,
                customerName: feature.customerName,
                features: []
            });
        }
        customerGroups.get(feature.customerId).features.push(feature);
    });

    title.innerHTML = `<i class="fas fa-list-check"></i> ${labels[dashboardFeatureFilter]}`;
    grid.innerHTML = customerGroups.size ? [...customerGroups.values()].map(customer => `
        <div class="customer-overview-card">
            <div class="cust-card-header">
                <h4><i class="fas fa-building" style="color:var(--primary);margin-right:8px;"></i>${escHtml(customer.customerName)}</h4>
                <span class="badge badge-gray">${customer.features.length} Module${customer.features.length !== 1 ? 's' : ''}</span>
            </div>
            <div class="poc-tag-list">
                ${customer.features.map(feature => `
                    <div class="poc-tag-item" onclick="showPoc('${feature.customerId}', '${feature.id}')" title="Open ${escHtml(feature.name)} test cases">
                        <span><i class="fas fa-flask" style="color:var(--primary);margin-right:6px;"></i>${escHtml(feature.name)}</span>
                        <span class="badge ${feature.state === 'completed' ? 'badge-pass' : feature.state === 'under-test' ? 'badge-info' : 'badge-gray'}">
                            ${feature.state === 'completed' ? 'Completed' : feature.state === 'under-test' ? 'Under Test' : 'Not Tested'}
                        </span>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('') : `
        <div class="empty-state" style="grid-column:1/-1;">
            <i class="fas fa-list-check"></i>
            <p>No modules in this category.</p>
        </div>`;
    section.style.display = 'block';
}

function renderDashboard() {
    let totalCustomers = db.customers.length;
    let totalPocs = 0, totalTCs = 0, totalPass = 0, totalFail = 0;
    const features = [];
    db.customers.forEach(c => {
        totalPocs += c.pocs.length;
        c.pocs.forEach(p => {
            totalTCs += p.testCases.length;
            const stats = getTestCaseStats(p.testCases);
            const executionState = getFeatureExecutionState(p);
            const totalExecuted = p.testCases.filter(testCase => testCase.status && testCase.status !== 'Not Executed').length;
            features.push({
                customerId: c.id,
                customerName: c.name,
                id: p.id,
                name: p.name,
                testCases: p.testCases.length,
                executed: totalExecuted,
                final: RESULT_TEST_STATUSES.reduce((count, status) => count + stats[status], 0),
                passed: stats.Pass,
                defects: stats.Fail,
                state: executionState
            });
            p.testCases.forEach(tc => {
                if (tc.status === 'Pass') totalPass++;
                if (tc.status === 'Fail') totalFail++;
            });
        });
    });

    const statsEl = document.getElementById('dashboardStats');
    if (statsEl) {
        const underTest = features.filter(feature => feature.state === 'under-test').length;
        const notTested = features.filter(feature => feature.state === 'not-tested').length;
        const completed = features.filter(feature => feature.state === 'completed').length;
        statsEl.innerHTML = `
            <div class="stat-card"><div class="stat-number">${totalCustomers}</div><div class="stat-label">Features</div></div>
            <div class="stat-card"><div class="stat-number">${totalPocs}</div><div class="stat-label">Modules</div></div>
            <div class="stat-card"><div class="stat-number">${totalTCs}</div><div class="stat-label">Test Cases</div></div>
            <div class="stat-card"><div class="stat-number" style="color:var(--success)">${totalPass}</div><div class="stat-label">Passed</div></div>
            <div class="stat-card"><div class="stat-number" style="color:var(--danger)">${totalFail}</div><div class="stat-label">Failed</div></div>
            <button class="stat-card stat-card-filter ${dashboardFeatureFilter === 'under-test' ? 'selected' : ''}" onclick="showDashboardFeatureFilter('under-test')" aria-pressed="${dashboardFeatureFilter === 'under-test'}" title="Show modules currently under test">
                <span class="stat-number">${underTest}</span><span class="stat-label">Modules Under Test</span>
            </button>
            <button class="stat-card stat-card-filter ${dashboardFeatureFilter === 'not-tested' ? 'selected' : ''}" onclick="showDashboardFeatureFilter('not-tested')" aria-pressed="${dashboardFeatureFilter === 'not-tested'}" title="Show modules not yet tested">
                <span class="stat-number">${notTested}</span><span class="stat-label">Modules Not Tested</span>
            </button>
            <button class="stat-card stat-card-filter ${dashboardFeatureFilter === 'completed' ? 'selected' : ''}" onclick="showDashboardFeatureFilter('completed')" aria-pressed="${dashboardFeatureFilter === 'completed'}" title="Show completed modules">
                <span class="stat-number">${completed}</span><span class="stat-label">Modules Completed</span>
            </button>
        `;
    }

    renderDashboardFeatureFilter(features);

    const featureBody = document.getElementById('dashboardFeatureBody');
    const emptyFeatureState = document.getElementById('emptyDashboardFeatures');
    const emptyFeatureMessage = document.getElementById('emptyDashboardFeaturesMessage');
    const featureSelect = document.getElementById('dashboardFeatureSelect');
    const visibleCustomers = getVisibleCustomers();
    if (featureSelect) {
        if (dashboardCustomerFilter !== 'all' &&
            !visibleCustomers.some(customer => customer.id === dashboardCustomerFilter)) {
            dashboardCustomerFilter = 'all';
        }
        featureSelect.innerHTML = '<option value="all">All Features</option>' + visibleCustomers.map(customer =>
            `<option value="${escHtml(customer.id)}">${escHtml(customer.name)}</option>`
        ).join('');
        featureSelect.value = dashboardCustomerFilter;
    }
    if (featureBody && emptyFeatureState) {
        const featureRows = features.filter(feature =>
            dashboardCustomerFilter === 'all' || feature.customerId === dashboardCustomerFilter
        ).sort((a, b) =>
            a.customerName.localeCompare(b.customerName, undefined, { numeric: true }) ||
            a.name.localeCompare(b.name, undefined, { numeric: true })
        );
        featureBody.innerHTML = featureRows.map(feature => {
            const executionPercent = feature.testCases ? Math.round(feature.executed / feature.testCases * 100) : 0;
            const passPercent = feature.final ? Math.round(feature.passed / feature.final * 100) : 0;
            const stateLabel = feature.state === 'under-test' ? 'Under Test' :
                feature.state === 'completed' ? 'Completed' : 'Not Tested';
            const stateClass = feature.state === 'under-test' ? 'badge-info' :
                feature.state === 'completed' ? 'badge-pass' : 'badge-gray';
            return `<tr>
                <td>${escHtml(feature.customerName)}</td>
                <td><button class="dashboard-feature-link" onclick="showPoc('${feature.customerId}', '${feature.id}')" title="Open ${escHtml(feature.name)} test cases">${escHtml(feature.name)}</button></td>
                <td><span class="badge ${stateClass}">${stateLabel}</span></td>
                <td>${feature.testCases}</td>
                <td>${executionPercent}%</td>
                <td>${passPercent}%</td>
                <td>${feature.defects}</td>
            </tr>`;
        }).join('');
        emptyFeatureState.style.display = featureRows.length ? 'none' : 'block';
        if (emptyFeatureMessage) {
            emptyFeatureMessage.textContent = dashboardCustomerFilter === 'all'
                ? 'No module data available yet.'
                : 'No module data available for this feature yet.';
        }
    }

    // Render Customer & POC Navigation Cards on Dashboard
    const gridEl = document.getElementById('dashboardCustomerGrid');
    if (gridEl) {
        if (db.customers.length === 0) {
            gridEl.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <i class="fas fa-building-circle-check"></i>
                    <p>No features created yet. Click "+ Add" in the sidebar or "Import Test Cases" above.</p>
                </div>`;
        } else {
            gridEl.innerHTML = db.customers.map(c => `
                <div class="customer-overview-card">
                    <div class="cust-card-header">
                        <h4 onclick="showCustomer('${c.id}')"><i class="fas fa-building" style="color:var(--primary);margin-right:8px;"></i>${escHtml(c.name)}</h4>
                        <div style="display: flex; align-items: center; gap: 6px;">
                                            <span class="badge badge-gray">${c.pocs.length} Module${c.pocs.length !== 1 ? 's' : ''}</span>
                                            ${isAdmin ? `<button class="btn btn-outline btn-sm" onclick="event.stopPropagation(); copyCustomerLink('${c.id}')" title="Copy private feature link for ${escHtml(c.name)}"><i class="fas fa-link"></i> Link</button>` : ''}
                        </div>
                    </div>
                    <div class="poc-tag-list">
                        ${c.pocs.length === 0 ? '<p style="font-size:12px;color:var(--gray-400);">No modules yet.</p>' : 
                            c.pocs.map(p => {
                                const st = getTestCaseStats(p.testCases);
                                return `
                                    <div class="poc-tag-item" onclick="showPoc('${c.id}', '${p.id}')" title="Open ${escHtml(p.name)} Test Cases">
                                        <span><i class="fas fa-flask" style="color:var(--primary);margin-right:6px;"></i>${escHtml(p.name)}</span>
                                        <span class="badge ${st.Pass > 0 && st.Pass === st.total ? 'badge-pass' : 'badge-info'}">${st.total} tests</span>
                                    </div>
                                `;
                            }).join('')
                        }
                    </div>
                </div>
            `).join('');
        }
    }
}

// ============================================================
// RENDER: POC GRID (Customer View)
// ============================================================
function renderPocGrid() {
    const customer = getCustomer(currentCustomerId);
    const grid = document.getElementById('pocGrid');
    if (!customer || customer.pocs.length === 0) {
        grid.innerHTML = `<div class="empty-state"><i class="fas fa-folder-open"></i><p>No modules yet for this feature. Click "Add Module" to create one.</p></div>`;
        return;
    }
    grid.innerHTML = customer.pocs.map(poc => {
        const stats = getTestCaseStats(poc.testCases);
        const passRate = stats.total > 0 ? Math.round((stats.Pass / stats.total) * 100) : 0;
        const progressClass = passRate >= 70 ? 'good' : passRate >= 40 ? 'medium' : 'bad';
        return `
        <div class="poc-card" onclick="showPoc('${customer.id}', '${poc.id}')">
            <div class="poc-card-heading">
                <h3><i class="fas fa-flask" style="color:var(--primary);margin-right:6px;"></i>${escHtml(poc.name)}</h3>
                ${isAdmin ? `<button class="btn btn-outline btn-sm" onclick="event.stopPropagation(); renamePoc('${customer.id}', '${poc.id}')" title="Edit Module Name"><i class="fas fa-pen"></i> Edit</button>` : ''}
            </div>
            <div class="poc-meta">
                <span><i class="fas fa-list-check"></i> ${stats.total} test cases</span>
                <span><i class="fas fa-chart-pie"></i> ${passRate}% pass rate</span>
            </div>
            <div class="progress-bar"><div class="progress-fill ${progressClass}" style="width:${passRate}%"></div></div>
            <div class="poc-stats-row">
                <span class="poc-stat-badge badge-pass">${stats.Pass} Pass</span>
                <span class="poc-stat-badge badge-fail">${stats.Fail} Fail</span>
                <span class="poc-stat-badge badge-fail">${stats['Partially Pass']} Partially Pass</span>
                <span class="poc-stat-badge badge-blocked" style="background:var(--blocked-bg);color:var(--blocked)">${stats.Blocked} Blocked</span>
                <span class="poc-stat-badge badge-gray">${stats['Not Executed']} Pending</span>
                <span class="poc-stat-badge badge-gray">${stats['Not Applicable']} Not Applicable</span>
            </div>
        </div>`;
    }).join('');
}

// ============================================================
// RENDER: TEST CASES TABLE (Execution Page)
// ============================================================
function renderTestCases() {
    const poc = getPoc(currentCustomerId, currentPocId);
    if (!poc) return;

    const columns = getPocColumns(poc);
    const statusFilter = document.getElementById('statusFilter')?.value || 'all';
    const moduleFilter = document.getElementById('moduleFilter')?.value || 'all';
    const search = (document.getElementById('searchInput')?.value || '').toLowerCase();

    const filtered = poc.testCases.filter(tc => {
        if (statusFilter !== 'all' && tc.status !== statusFilter) return false;
        if (moduleFilter !== 'all' && getFeatureName(tc, columns) !== moduleFilter) return false;
        if (search) {
            const text = columns.map(column => getTestCaseValue(tc, column)).join(' ').toLowerCase();
            if (!text.includes(search)) return false;
        }
        return true;
    }).sort((a, b) => {
        const first = Number(a.testNo);
        const second = Number(b.testNo);
        if (Number.isFinite(first) && Number.isFinite(second)) return first - second;
        return String(a.testNo ?? '').localeCompare(String(b.testNo ?? ''), undefined, { numeric: true });
    });

    const tbody = document.getElementById('testCaseBody');
    const thead = document.getElementById('testCaseHead');
    const colgroup = document.getElementById('testCaseColumns');
    const emptyMsg = document.getElementById('emptyTestCases');
    const table = document.getElementById('testCaseTable');
    // Fit each column to its own visible content; do not distribute empty space.
    const widths = columns.map(column => getAutoColumnWidth(filtered, column));
    if (isAdmin) widths.push(92);
    if (colgroup) {
        colgroup.innerHTML = widths.map(width => `<col style="width:${width}px">`).join('');
    }
    table.style.width = `${widths.reduce((total, width) => total + width, 0)}px`;
    if (thead) {
        thead.innerHTML = `
            <tr>
                ${columns.map((column, index) => `
                    <th class="${getColumnKind(column) === 'module' ? 'col-module' : ''}" data-column-index="${index}">
                        ${escHtml(column)}
                        <span class="column-resizer" title="Drag to resize column" aria-label="Resize ${escHtml(column)} column"></span>
                    </th>`).join('')}
                ${isAdmin ? '<th class="col-actions">Actions</th>' : ''}
            </tr>
        `;
    }
    attachColumnResizers(poc, columns);

    if (filtered.length === 0) {
        tbody.innerHTML = '';
        emptyMsg.style.display = 'block';
        table.style.display = 'none';
    } else {
        emptyMsg.style.display = 'none';
        table.style.display = 'table';
        tbody.innerHTML = filtered.map((tc) => {
            const statusClass = 'status-' + String(tc.status || 'Not Executed').toLowerCase().replace(/\s+/g, '-');
            return `
            <tr data-id="${tc.id}">
                ${columns.map(column => {
                    const kind = getColumnKind(column);
                    const value = String(getTestCaseValue(tc, column) ?? '');
                    if (kind === 'status') {
                        const statusEnabled = poc.executionStartedAt && hasTestCaseResults(tc, columns);
                        const statusDisabledTitle = !poc.executionStartedAt
                            ? 'Start execution to update test statuses'
                            : 'Fill Expected Result and Actual Result to enable status';
                        return `<td><select class="status-select ${statusClass}" data-id="${tc.id}" onchange="onStatusChange(this)" ${statusEnabled ? '' : `disabled title="${statusDisabledTitle}"`}>
                            <option value="Not Executed" ${tc.status === 'Not Executed' ? 'selected' : ''}>Not Executed</option>
                            <option value="In Progress" ${tc.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
                            <option value="Pass" ${tc.status === 'Pass' ? 'selected' : ''}>Pass</option>
                            <option value="Fail" ${tc.status === 'Fail' ? 'selected' : ''}>Fail</option>
                            <option value="Partially Pass" ${tc.status === 'Partially Pass' ? 'selected' : ''}>Partially Pass</option>
                            <option value="Blocked" ${tc.status === 'Blocked' ? 'selected' : ''}>Blocked</option>
                            <option value="Not Applicable" ${tc.status === 'Not Applicable' ? 'selected' : ''}>Not Applicable</option>
                        </select></td>`;
                    }
                    if (kind === 'testNo') {
                        return `<td class="col-no" style="text-align:center;font-weight:600;color:var(--gray-600)"><div class="editable-cell" contenteditable="true" data-column="${escHtml(column)}" data-id="${tc.id}" onblur="onCellEdit(this)">${escHtml(value)}</div></td>`;
                    }
                    return `<td class="${kind === 'module' ? 'col-module' : ''}"><div class="editable-cell" contenteditable="true" data-column="${escHtml(column)}" data-id="${tc.id}" onblur="onCellEdit(this)">${escHtml(value)}</div></td>`;
                }).join('')}
                ${isAdmin ? `
                <td class="col-actions">
                    <div class="row-actions">
                        <button title="Delete Test Case" onclick="deleteTestCase('${tc.id}')"><i class="fas fa-trash"></i></button>
                    </div>
                </td>` : ''}
            </tr>`;
        }).join('');
    }

    renderExecutionControls(poc);

    // Stats bar update
    const allStats = getTestCaseStats(poc.testCases);
    const pocStatsEl = document.getElementById('pocStats');
    if (pocStatsEl) {
        pocStatsEl.innerHTML = `
            <span class="badge badge-pass">${allStats.Pass} Pass</span>
            <span class="badge badge-fail">${allStats.Fail} Fail</span>
            <span class="badge badge-fail">${allStats['Partially Pass']} Partially Pass</span>
            <span class="badge" style="background:var(--blocked-bg);color:var(--blocked)">${allStats.Blocked} Blocked</span>
            <span class="badge badge-info">${allStats['In Progress']} In Prog</span>
            <span class="badge badge-gray">${allStats['Not Executed']} Pending</span>
            <span class="badge badge-gray">${allStats['Not Applicable']} Not Applicable</span>
        `;
    }
    const pocBadge = document.getElementById('pocBadge');
    if (pocBadge) {
        pocBadge.textContent = `${allStats.total} test cases`;
        pocBadge.className = 'badge badge-info';
    }
    requestAnimationFrame(syncTestTableScrollProxy);
}

function attachColumnResizers(poc, columns) {
    document.querySelectorAll('#testCaseHead .column-resizer').forEach(handle => {
        handle.addEventListener('pointerdown', event => {
            event.preventDefault();
            const header = handle.parentElement;
            const columnIndex = Number(header.dataset.columnIndex);
            const column = columns[columnIndex];
            const col = document.querySelectorAll('#testCaseColumns col')[columnIndex];
            const startX = event.clientX;
            const startWidth = col.getBoundingClientRect().width;
            handle.classList.add('resizing');

            const resize = moveEvent => {
                const width = Math.max(72, Math.round(startWidth + moveEvent.clientX - startX));
                col.style.width = `${width}px`;
                const widths = [...document.querySelectorAll('#testCaseColumns col')];
                document.getElementById('testCaseTable').style.width =
                    `${widths.reduce((total, item) => total + item.getBoundingClientRect().width, 0)}px`;
            };
            const stopResize = () => {
                document.removeEventListener('pointermove', resize);
                document.removeEventListener('pointerup', stopResize);
                handle.classList.remove('resizing');
                requestAnimationFrame(syncTestTableScrollProxy);
            };
            document.addEventListener('pointermove', resize);
            document.addEventListener('pointerup', stopResize, { once: true });
        });
    });
}

function getAutoColumnWidth(testCases, column) {
    const table = document.getElementById('testCaseTable');
    if (!table) return 160;
    const kind = getColumnKind(column);
    const minimum = kind === 'testNo' ? 76 : kind === 'status' ? 155 : 90;
    const maximum = kind === 'testNo' ? 100 : kind === 'status' ? 185 :
        kind === 'module' ? 260 : 300;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return minimum;
    const font = getComputedStyle(table).fontFamily;
    context.font = `600 12px ${font}`;
    let required = context.measureText(String(column).toUpperCase()).width + 44;
    context.font = `13px ${font}`;
    for (const testCase of testCases) {
        const text = String(getTestCaseValue(testCase, column) ?? '');
        for (const line of text.split(/\r?\n/)) {
            required = Math.max(required, context.measureText(line).width + 34);
        }
    }
    // Width follows content, with a cap so lengthy descriptions wrap.
    return Math.ceil(Math.min(maximum, Math.max(minimum, required)));
}

function syncTestTableScrollProxy() {
    const proxy = document.getElementById('testTableScrollProxy');
    const proxyContent = document.getElementById('testTableScrollProxyContent');
    const container = document.querySelector('#pocView .table-container');
    const pocView = document.getElementById('pocView');
    const table = document.getElementById('testCaseTable');
    if (!proxy || !proxyContent || !container || !pocView || !table) return;

    if (!tableScrollProxyInitialized) {
        proxy.addEventListener('scroll', () => {
            if (tableScrollSyncing) return;
            tableScrollSyncing = true;
            table.style.transform = `translateX(-${proxy.scrollLeft}px)`;
            tableScrollSyncing = false;
        });
        window.addEventListener('resize', () => {
            if (currentPocId && !document.activeElement?.isContentEditable) renderTestCases();
            syncTestTableScrollProxy();
        });
        tableScrollProxyInitialized = true;
    }

    const visible = pocView.classList.contains('active') &&
        table.style.display !== 'none' &&
        table.offsetWidth > container.clientWidth + 1;
    if (!visible) {
        table.style.transform = '';
        proxy.style.display = 'none';
        return;
    }

    const bounds = container.getBoundingClientRect();
    proxy.style.left = `${bounds.left}px`;
    proxy.style.width = `${bounds.width}px`;
    proxyContent.style.width = `${table.offsetWidth}px`;
    proxy.style.display = 'block';
    proxy.scrollLeft = Math.min(proxy.scrollLeft, Math.max(0, table.offsetWidth - proxy.clientWidth));
    table.style.transform =
        `translateX(-${proxy.scrollLeft}px)`;
}

function populateModuleFilter() {
    const poc = getPoc(currentCustomerId, currentPocId);
    const select = document.getElementById('moduleFilter');
    if (!select) return;
    const columns = poc ? getPocColumns(poc) : [];
    const modules = [...new Set((poc?.testCases || []).map(tc => getFeatureName(tc, columns)).filter(Boolean))];
    select.innerHTML = '<option value="all">All</option>' + modules.map(m => `<option value="${escHtml(m)}">${escHtml(m)}</option>`).join('');
}

function renderExecutionControls(poc) {
    const control = document.getElementById('pocExecutionControl');
    if (!control) return;
    if (!poc.executionStartedAt) {
        control.innerHTML = '<button class="btn btn-primary" onclick="startTestExecution()"><i class="fas fa-play"></i> Start Execution</button>';
        return;
    }
    const completed = poc.executionStatus === 'Completed';
    control.innerHTML = `<div class="execution-state">
        <span class="badge ${completed ? 'badge-pass' : 'badge-info'}">${completed ? 'Completed' : 'In Progress'}</span>
    </div>`;
}

// ============================================================
// INLINE EDITING
// ============================================================
function onCellEdit(el) {
    const tcId = el.dataset.id;
    const column = el.dataset.column;
    const value = el.innerText.trim();
    const poc = getPoc(currentCustomerId, currentPocId);
    if (!poc) return;
    const tc = poc.testCases.find(t => t.id === tcId);
    if (tc && getTestCaseValue(tc, column) !== value) {
        const kind = getColumnKind(column);
        if (kind) tc[kind] = value;
        tc.values = tc.values || {};
        tc.values[column] = value;
        if (poc.columnWidths) delete poc.columnWidths[column];
        saveData();
        renderTestCases();
    }
}

function onStatusChange(el) {
    const poc = getPoc(currentCustomerId, currentPocId);
    if (!poc?.executionStartedAt) {
        toast('Start execution before updating test statuses.', 'info');
        renderTestCases();
        return;
    }
    const tcId = el.dataset.id;
    const tc = poc.testCases.find(t => t.id === tcId);
    if (tc && !hasTestCaseResults(tc, getPocColumns(poc))) {
        toast('Fill Expected Result and Actual Result before updating the test status.', 'info');
        renderTestCases();
        return;
    }
    const value = el.value;
    if (tc) {
        tc.status = value;
        const statusColumn = getPocColumns(poc).find(column => getColumnKind(column) === 'status');
        if (statusColumn) {
            tc.values = tc.values || {};
            tc.values[statusColumn] = value;
        }
        updateExecutionState(poc);
        saveData();
        renderTestCases();
    }
}

function startTestExecution() {
    const poc = getPoc(currentCustomerId, currentPocId);
    if (!poc || !poc.testCases.length) {
        toast('Add test cases before starting execution.', 'error');
        return;
    }
    if (poc.executionStartedAt) return;
    poc.executionStartedAt = new Date().toISOString();
    updateExecutionState(poc);
    saveData();
    renderTestCases();
    toast(poc.executionStatus === 'Completed' ? 'Execution completed: all test cases already have final statuses.' : 'Test execution started.', 'success');
}

function showAddColumnModal() {
    if (!isAdmin) {
        toast('Only Admin users can add columns.', 'error');
        return;
    }
    openModal('Add Table Column', `
        <div class="form-group">
            <label>Column Header</label>
            <input type="text" id="newColumnName" placeholder="e.g. Build Version" maxlength="80">
        </div>
    `, () => {
        if (!isAdmin) {
            toast('Only Admin users can add columns.', 'error');
            return false;
        }
        const name = document.getElementById('newColumnName').value.trim();
        const poc = getPoc(currentCustomerId, currentPocId);
        if (!poc) return false;
        if (!name) {
            toast('Enter a column header.', 'error');
            return false;
        }
        const columns = [...getPocColumns(poc)];
        if (getColumnKind(name) === 'status' || getColumnKind(name) === 'testNo') {
            toast('Status and Sr. No. are required table columns.', 'error');
            return false;
        }
        if (columns.some(column => column.toLowerCase() === name.toLowerCase())) {
            toast('That column already exists.', 'error');
            return false;
        }
        poc.columns = [...columns, name];
        saveData();
        renderTestCases();
        toast(`Column "${name}" added.`, 'success');
    });
}

function showDeleteColumnModal() {
    if (!isAdmin) {
        toast('Only Admin users can delete columns.', 'error');
        return;
    }
    const poc = getPoc(currentCustomerId, currentPocId);
    if (!poc) return;
    const removableColumns = getPocColumns(poc).filter(column => !['status', 'testNo'].includes(getColumnKind(column)));
    if (!removableColumns.length) {
        toast('There are no removable columns.', 'info');
        return;
    }
    openModal('Delete Table Column', `
        <div class="form-group">
            <label>Column to delete</label>
            <select id="deleteColumnName">${removableColumns.map(column => `<option value="${escHtml(column)}">${escHtml(column)}</option>`).join('')}</select>
            <p style="font-size:12px;color:var(--gray-500);margin-top:6px;">Status and Sr. No. are required and cannot be deleted.</p>
        </div>
    `, () => {
        const name = document.getElementById('deleteColumnName').value;
        const currentPoc = getPoc(currentCustomerId, currentPocId);
        if (!currentPoc || !isAdmin) return false;
        currentPoc.columns = getPocColumns(currentPoc).filter(column => column !== name);
        currentPoc.testCases.forEach(testCase => {
            if (testCase.values) delete testCase.values[name];
            if (currentPoc.columnWidths) delete currentPoc.columnWidths[name];
        });
        saveData();
        renderTestCases();
        toast(`Column "${name}" deleted.`, 'info');
    });
}

// ============================================================
// DEDICATED SEPARATE ADMIN IMPORT MENU (Upload Excel)
// ============================================================
function showAdminUploadModal() {
    if (!isAdmin) {
        toggleAdminMode();
        return;
    }
    if (db.customers.length === 0) {
        toast('Create a feature first, then import the workbook into it.', 'error');
        return;
    }
    const customerOptions = db.customers.map(c => `
        <option value="${c.id}" ${c.id === currentCustomerId ? 'selected' : ''}>${escHtml(c.name)}</option>
    `).join('');

    openModal('Import Excel into Feature', `
        <div class="form-group">
            <label>Target Feature</label>
            <select id="importCustomerSelect">
                ${customerOptions}
            </select>
        </div>
        <div class="form-group">
            <label>Select file</label>
            <input type="file" id="importFileInput" style="padding: 6px;">
            <p style="font-size:12px;color:var(--gray-500);margin-top:6px;">
                        Select any file. Spreadsheet files supported by the importer are read; all rows and worksheets go into one module named after the file, inside the selected feature.
            </p>
        </div>
    `, () => {
        const select = document.getElementById('importCustomerSelect');
        const fileInput = document.getElementById('importFileInput');
        const file = fileInput.files[0];

        if (!file) {
            toast('Please choose a file to upload.', 'error');
            return false;
        }

        const targetCustomer = getCustomer(select.value);
        if (!targetCustomer) {
            toast('Select an existing feature before importing.', 'error');
            return false;
        }

        executeExcelImport(file, targetCustomer);
        return true;
    });

}

function executeExcelImport(file, customer) {
    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const workbook = XLSX.read(e.target.result, { type: 'array' });
            const importColumns = [];
            const importRows = [];
            for (const sheetName of workbook.SheetNames) {
                const sheet = workbook.Sheets[sheetName];
                const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
                const headerRow = findImportHeaderRow(rawRows);
                if (!headerRow) {
                    toast(`Upload rejected: sheet "${sheetName}" must have a header row containing Status and at least one test-case column within its first 20 rows.`, 'error');
                    return;
                }
                const sourceHeaders = headerRow.headers;
                const headers = [];
                sourceHeaders.forEach(header => {
                    if (!header) return;
                    let uniqueHeader = header;
                    let suffix = 2;
                    while (headers.includes(uniqueHeader)) uniqueHeader = `${header} (${suffix++})`;
                    headers.push(uniqueHeader);
                });

                const rows = rawRows.slice(headerRow.rowIndex + 1).filter(row => row.some(value => String(value ?? '').trim() !== ''))
                    .map(row => {
                        const entry = {};
                        let headerIndex = 0;
                        sourceHeaders.forEach((header, sourceIndex) => {
                            if (!header) return;
                            const uniqueHeader = headers[headerIndex++];
                            entry[uniqueHeader] = row[sourceIndex] ?? '';
                        });
                        return entry;
                    });
                if (!rows.length) continue;

                headers.forEach(header => {
                    if (!importColumns.includes(header)) importColumns.push(header);
                });
                importRows.push(...rows);
            }
            if (!importRows.length) {
                toast('Excel file contains no test cases to import.', 'error');
                return;
            }

            const moduleName = file.name.replace(/\.(xlsx|xls|csv)$/i, '').trim() || 'Imported Module';
            if (!db.customers.some(existing => existing.id === customer.id)) {
                db.customers.push(customer);
            }
            const poc = createOrGetPoc(customer, moduleName, importColumns);
            const colMap = detectColumns(importColumns);
            const mergedColumns = Array.isArray(poc.columns) && poc.columns.length
                ? [...poc.columns]
                : poc.testCases.length ? [...DEFAULT_TEST_COLUMNS] : [...importColumns];
            importColumns.forEach(column => {
                if (!mergedColumns.includes(column)) mergedColumns.push(column);
            });
            poc.columns = mergedColumns;
            importRows.forEach((row, index) => {
                poc.testCases.push(rowToTestCase(row, colMap, poc.testCases.length + index + 1, importColumns));
            });
            updateExecutionState(poc);

            saveData();
            showCustomer(customer.id);
            renderSidebar();
            toast(`Successfully imported ${importRows.length} test cases into one module: ${moduleName}.`, 'success');
        } catch (err) {
            console.error('Import error:', err);
            toast('Unable to import this file. Choose a supported spreadsheet file. ' + err.message, 'error');
        }
    };
    reader.onerror = () => {
        console.error('File read error:', reader.error);
        toast('Unable to read the selected file.', 'error');
    };
    reader.readAsArrayBuffer(file);
}

// --- Helpers for Excel import ---
function rowToTestCase(row, colMap, testNo, headers) {
    const excelTestNo = colMap.testNo && row[colMap.testNo] !== undefined
        ? String(row[colMap.testNo]).trim()
        : testNo;
    const status = normalizeStatus(String(row[colMap.status] || 'Not Executed').trim());
    const values = {};
    headers.forEach(header => { values[header] = String(row[header] ?? '').trim(); });
    return {
        id: genId(),
        testNo: excelTestNo || testNo,
        module: String(row[colMap.module] || '').trim(),
        scenario: String(row[colMap.scenario] || '').trim(),
        execStep: String(row[colMap.execStep] || '').trim(),
        expectedBehavior: String(row[colMap.expected] || '').trim(),
        actualBehavior: String(row[colMap.actual] || '').trim(),
        comment: String(row[colMap.comment] || '').trim(),
        status,
        values
    };
}

function createOrGetPoc(customer, pocName, columns) {
    let poc = customer.pocs.find(p => p.name.toLowerCase() === pocName.toLowerCase());
    if (!poc) {
        poc = { id: genId(), name: pocName, columns: [...columns], testCases: [] };
        customer.pocs.push(poc);
    }
    return poc;
}

function detectColumns(headers) {
    const lower = headers.map(h => h.toLowerCase());
    function find(keywords) {
        for (const kw of keywords) {
            const idx = lower.findIndex(h => h.includes(kw));
            if (idx !== -1) return headers[idx];
        }
        return null;
    }
    return {
        testNo:   find(['sr. no.', 'sr no', 'serial no', 'serial number', 'test no', 'test number']),
        module:   find(['module', 'component', 'feature', 'area']) || headers[1] || '',
        scenario: find(['scenario', 'test case', 'testcase', 'description', 'title', 'name']) || headers[2] || '',
        execStep: find(['exec', 'step', 'procedure', 'action', 'steps']) || headers[3] || '',
        expected: find(['expected', 'expect']) || headers[4] || '',
        actual:   find(['actual', 'result', 'observed']) || headers[5] || '',
        comment:  find(['comment', 'note', 'remark', 'observation']) || headers[6] || '',
        status:   find(['status'])
    };
}

function normalizeStatus(s) {
    const l = s.toLowerCase();
    if (l.includes('not applicable') || l === 'n/a' || l === 'na') return 'Not Applicable';
    if (l.includes('partially pass')) return 'Partially Pass';
    if (l.includes('pass') || l === 'p' || l === 'yes' || l === 'ok') return 'Pass';
    if (l.includes('fail') || l === 'f' || l === 'no' || l === 'nok') return 'Fail';
    if (l.includes('block')) return 'Blocked';
    if (l.includes('progress') || l.includes('wip')) return 'In Progress';
    return 'Not Executed';
}

// ============================================================
// CRUD OPERATIONS
// ============================================================

// --- Feature ---
function showAddCustomerModal() {
    openModal('Add Feature', `
        <div class="form-group">
            <label>Feature Name</label>
            <input type="text" id="modalInput1" placeholder="e.g. Inventory" autofocus>
        </div>
    `, () => {
        const name = document.getElementById('modalInput1').value.trim();
        if (!name) { toast('Please enter a name', 'error'); return false; }
        const slug = (name || 'client').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'client';
        const accessKey = slug + '_' + Math.random().toString(36).substring(2, 7);
        const newCust = { id: genId(), name, accessKey, pocs: [] };
        db.customers.push(newCust);
        saveData();
        renderSidebar();
        showCustomer(newCust.id);
        toast(`Feature "${name}" created! Link ready to share.`, 'success');
    });
}

function renameCurrentCustomer() {
    if (!isAdmin) {
        toggleAdminMode();
        return;
    }
    const customer = getCustomer(currentCustomerId);
    if (!customer) {
        toast('Feature not found.', 'error');
        return;
    }

    openModal('Edit Feature Name', `
        <div class="form-group">
            <label for="editFeatureName">Feature Name</label>
            <input type="text" id="editFeatureName" value="${escHtml(customer.name)}" maxlength="120" autofocus>
        </div>
    `, () => {
        const input = document.getElementById('editFeatureName');
        const name = input ? input.value.trim() : '';
        if (!name) {
            toast('Please enter a feature name.', 'error');
            return false;
        }
        customer.name = name;
        saveData();
        renderSidebar();
        renderDashboard();
        if (currentCustomerId === customer.id) {
            document.getElementById('customerTitle').textContent = customer.name;
        }
        toast('Feature name updated.', 'success');
    });
}

function deleteCurrentCustomer() {
    if (!isAdmin) { toggleAdminMode(); return; }
    if (!currentCustomerId) return;
    const c = getCustomer(currentCustomerId);
    if (!confirm(`Delete feature "${c.name}" and all its modules & test cases?`)) return;
    db.customers = db.customers.filter(c => c.id !== currentCustomerId);
    saveData();
    renderSidebar();
    showDashboard();
    toast('Feature deleted', 'info');
}

// --- Module ---
function showAddPocModal() {
    openModal('Add Module', `
        <div class="form-group">
            <label>Module Name</label>
            <input type="text" id="modalInput1" placeholder="e.g. Static Replenishment" autofocus>
        </div>
    `, () => {
        const name = document.getElementById('modalInput1').value.trim();
        if (!name) { toast('Please enter a name', 'error'); return false; }
        const customer = getCustomer(currentCustomerId);
        customer.pocs.push({ id: genId(), name, testCases: [] });
        saveData();
        renderPocGrid();
        renderSidebar();
        toast(`Module "${name}" added!`, 'success');
    });
}

function renameCurrentPoc() {
    renamePoc(currentCustomerId, currentPocId);
}

function renamePoc(customerId, pocId) {
    if (!isAdmin) {
        toggleAdminMode();
        return;
    }
    const customer = getCustomer(customerId);
    const poc = getPoc(customerId, pocId);
    if (!customer || !poc) {
        toast('Module not found.', 'error');
        return;
    }

    openModal('Edit Module Name', `
        <div class="form-group">
            <label for="editModuleName">Module Name</label>
            <input type="text" id="editModuleName" value="${escHtml(poc.name)}" maxlength="120" autofocus>
        </div>
    `, () => {
        const input = document.getElementById('editModuleName');
        const name = input ? input.value.trim() : '';
        if (!name) {
            toast('Please enter a module name.', 'error');
            return false;
        }
        poc.name = name;
        saveData();
        renderPocGrid();
        renderDashboard();
        if (currentCustomerId === customerId && currentPocId === pocId) {
            document.getElementById('pocTitle').textContent = `${customer.name} → ${poc.name}`;
        }
        toast('Module name updated.', 'success');
    });
}

function deleteCurrentPoc() {
    if (!isAdmin) { toggleAdminMode(); return; }
    if (!currentPocId) return;
    const poc = getPoc(currentCustomerId, currentPocId);
    if (!confirm(`Delete module "${poc.name}" and all its test cases?`)) return;
    const customer = getCustomer(currentCustomerId);
    customer.pocs = customer.pocs.filter(p => p.id !== currentPocId);
    saveData();
    showCustomer(currentCustomerId);
    renderSidebar();
    toast('Module deleted', 'info');
}

// --- Test Case ---
function showAddTestCaseModal() {
    const poc = getPoc(currentCustomerId, currentPocId);
    const nextNo = poc ? Math.max(0, ...poc.testCases.map(testCase => Number(testCase.testNo) || 0)) + 1 : 1;
    openModal('Add Test Case', `
        <div class="form-group"><label>Test No.</label><input type="number" id="tcNo" value="${nextNo}"></div>
        <div class="form-group"><label>Module</label><input type="text" id="tcModule" placeholder="e.g. Authentication"></div>
        <div class="form-group"><label>Scenario</label><textarea id="tcScenario" placeholder="e.g. Login with valid credentials"></textarea></div>
        <div class="form-group"><label>Execution Step</label><textarea id="tcStep" placeholder="e.g. 1. Open app  2. Enter credentials  3. Click Login"></textarea></div>
        <div class="form-group"><label>Expected Behavior</label><textarea id="tcExpected" placeholder="e.g. User is redirected to dashboard"></textarea></div>
    `, () => {
        const poc = getPoc(currentCustomerId, currentPocId);
        poc.testCases.push({
            id: genId(),
            testNo: parseInt(document.getElementById('tcNo').value) || poc.testCases.length + 1,
            module: document.getElementById('tcModule').value.trim(),
            scenario: document.getElementById('tcScenario').value.trim(),
            execStep: document.getElementById('tcStep').value.trim(),
            expectedBehavior: document.getElementById('tcExpected').value.trim(),
            actualBehavior: '',
            comment: '',
            status: 'Not Executed'
        });
        updateExecutionState(poc);
        saveData();
        renderTestCases();
        populateModuleFilter();
        toast('Test case added!', 'success');
    });
}

function deleteTestCase(tcId) {
    if (!isAdmin) { toggleAdminMode(); return; }
    const poc = getPoc(currentCustomerId, currentPocId);
    if (!poc) return;
    poc.testCases = poc.testCases.filter(t => t.id !== tcId);
    const testNoColumns = getPocColumns(poc).filter(column => getColumnKind(column) === 'testNo');
    [...poc.testCases].sort((a, b) => {
        const first = Number(a.testNo);
        const second = Number(b.testNo);
        if (Number.isFinite(first) && Number.isFinite(second)) return first - second;
        return String(a.testNo ?? '').localeCompare(String(b.testNo ?? ''), undefined, { numeric: true });
    }).forEach((testCase, index) => {
        testCase.testNo = index + 1;
        if (testNoColumns.length) {
            testCase.values = testCase.values || {};
            testNoColumns.forEach(column => {
                testCase.values[column] = index + 1;
            });
        }
    });
    updateExecutionState(poc);
    saveData();
    renderTestCases();
    toast('Test case deleted', 'info');
}

// ============================================================
// EXCEL EXPORT (Always accessible on execution page)
// ============================================================
function exportPocToExcel() {
    const poc = getPoc(currentCustomerId, currentPocId);
    const customer = getCustomer(currentCustomerId);
    if (!poc || poc.testCases.length === 0) { toast('No test cases to export', 'error'); return; }

    const columns = getPocColumns(poc);
    const testCases = [...poc.testCases].sort((a, b) => {
        const first = Number(a.testNo);
        const second = Number(b.testNo);
        if (Number.isFinite(first) && Number.isFinite(second)) return first - second;
        return String(a.testNo ?? '').localeCompare(String(b.testNo ?? ''), undefined, { numeric: true });
    });
    const data = testCases.map(testCase => Object.fromEntries(
        columns.map(column => [column, getTestCaseValue(testCase, column)])
    ));

    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = columns.map(column => ({ wch: Math.max(10, Math.min(36, column.length + 4)) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, poc.name.slice(0, 31));
    XLSX.writeFile(wb, `${customer.name}_${poc.name}_TestResults.xlsx`);
    toast('Excel exported successfully!', 'success');
}

// ============================================================
// FULL DATA BACKUP / RESTORE (JSON)
// ============================================================
function exportAllDataJSON() {
    const json = JSON.stringify(db, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `poc-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('JSON backup downloaded!', 'success');
}

function importAllDataJSON(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const imported = JSON.parse(e.target.result);
            if (!imported.customers || !Array.isArray(imported.customers)) {
                toast('Invalid backup file', 'error');
                return;
            }
            if (!confirm(`This will REPLACE all current data with the backup (${imported.customers.length} features). Continue?`)) return;
            db = imported;
            saveData();
            renderSidebar();
            showDashboard();
            toast('Data restored from backup!', 'success');
        } catch (err) {
            toast('Error reading backup: ' + err.message, 'error');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

// ============================================================
// MODAL HELPERS
// ============================================================
function openModal(title, bodyHtml, onSave) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = bodyHtml;
    document.getElementById('modalOverlay').classList.add('active');
    modalCallback = onSave;
    setTimeout(() => {
        const firstInput = document.querySelector('#modalBody input, #modalBody select, #modalBody textarea');
        if (firstInput) firstInput.focus();
    }, 100);
}

function closeModal() {
    document.getElementById('modalOverlay').classList.remove('active');
    modalCallback = null;
}

function modalSave() {
    if (modalCallback) {
        const result = modalCallback();
        if (result !== false) closeModal();
    }
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && document.getElementById('modalOverlay').classList.contains('active')) {
        const active = document.activeElement;
        if (active && active.tagName !== 'TEXTAREA') {
            e.preventDefault();
            modalSave();
        }
    }
    if (e.key === 'Escape') closeModal();
});

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
function toast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i> ${escHtml(message)}`;
    container.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3000);
}

// ============================================================
// UTILS
// ============================================================
function escHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
