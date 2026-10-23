// ============================================================
// POC Test Tracker — Firebase Cloud Version
// ============================================================

// =============================================
// 🔥 FIREBASE CONFIG
// =============================================
const firebaseConfig = {
    apiKey: "AIzaSyBYhQsnq3fLPlLjYNNHuftuZDd3BUAwOYg",
    authDomain: "poc-tracker-46580.firebaseapp.com",
    projectId: "poc-tracker-46580",
    storageBucket: "poc-tracker-46580.firebasestorage.app",
    messagingSenderId: "568469845077",
    appId: "1:568469845077:web:f80225c4a1bd6e640a10dc",
    measurementId: "G-HM82QL40RG"
};

// ---------- Firebase Init ----------
firebase.initializeApp(firebaseConfig);
const firestore = firebase.firestore();
const DB_DOC = firestore.collection('pocTracker').doc('mainData');

// ---------- State ----------
let db = { customers: [] };
let currentCustomerId = null;
let currentPocId = null;
let modalCallback = null;
let isLoading = true;
let isAdmin = sessionStorage.getItem('isAdmin') === 'true';
let activeCustomerKey = null;

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
            prompt('Copy this customer link:', link);
        });
    } else {
        prompt('Copy this customer link:', link);
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

    // 1. Check if user entered Admin Password
    if (code === 'Pa$$word') {
        isAdmin = true;
        sessionStorage.setItem('isAdmin', 'true');
        input.value = '';
        updateAdminUI();
        refreshCurrentView();
        toast('Admin access granted! All customers unlocked.', 'success');
        return;
    }

    // 2. Check if user entered Customer Access Code
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

// ---------- Admin Password Management ----------
function toggleAdminMode() {
    if (isAdmin) {
        isAdmin = false;
        sessionStorage.removeItem('isAdmin');
        updateAdminUI();
        toast('Admin mode deactivated.', 'info');
    } else {
        openModal('Admin Authentication', `
            <div class="form-group">
                <label>Enter Admin Password</label>
                <input type="password" id="adminPasswordInput" placeholder="Password" autofocus>
                <p style="font-size:12px; color:var(--gray-500); margin-top:6px;">
                    Unlocks Import Test Cases, Add POC/Test Cases, and Delete options.
                </p>
            </div>
        `, () => {
            const input = document.getElementById('adminPasswordInput');
            if (input && input.value === 'Pa$$word') {
                isAdmin = true;
                sessionStorage.setItem('isAdmin', 'true');
                updateAdminUI();
                toast('Admin mode activated! Tools unlocked.', 'success');
                return true;
            } else {
                toast('Incorrect password! Access denied.', 'error');
                return false;
            }
        });
    }
}

function updateAdminUI() {
    const adminControls = document.getElementById('adminControls');
    const adminToggleBtn = document.getElementById('adminToggleBtn');
    const adminToggleIcon = document.getElementById('adminToggleIcon');
    const adminToggleText = document.getElementById('adminToggleText');
    const sidebarAddCustBtn = document.getElementById('sidebarAddCustBtn');
    const customerAdminActions = document.getElementById('customerAdminActions');
    const pocAdminActions = document.getElementById('pocAdminActions');

    if (adminControls) adminControls.style.display = isAdmin ? 'flex' : 'none';
    if (sidebarAddCustBtn) sidebarAddCustBtn.style.display = isAdmin ? 'inline-flex' : 'none';
    if (customerAdminActions) customerAdminActions.style.display = isAdmin ? 'flex' : 'none';
    if (pocAdminActions) pocAdminActions.style.display = isAdmin ? 'flex' : 'none';

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
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('demo') === '1' || urlParams.get('demo') === '2') {
        db = {
            customers: [{
                id: 'c1',
                name: 'Acme Corp',
                accessKey: 'acme-corp_8x2a1',
                pocs: [{
                    id: 'p1',
                    name: 'Login Module POC',
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
                    name: 'Security POC',
                    testCases: []
                }]
            }]
        };
        isLoading = false;
        isAdmin = urlParams.get('admin') === '1';
        renderSidebar();
        if (urlParams.get('demo') === '2') {
            showDashboard();
        } else {
            showCustomer('c1');
        }
        updateAdminUI();
        return;
    }
    loadDataFromCloud();
});

// ============================================================
// DATA PERSISTENCE (Firebase Firestore)
// ============================================================
function loadDataFromCloud() {
    // Real-time listener: auto-syncs when anyone makes changes
    DB_DOC.onSnapshot((doc) => {
        if (doc.exists) {
            db = doc.data();
            if (!db.customers) db.customers = [];
        } else {
            db = { customers: [] };
            DB_DOC.set(db).catch(e => console.warn('Init set error:', e));
        }
        isLoading = false;
        refreshCurrentView();
    }, (error) => {
        console.error('Firebase snapshot error:', error);
        toast('Cloud sync notice: ' + error.message, 'error');
        // Fallback to localStorage if offline
        const stored = localStorage.getItem('pocTestTracker');
        if (stored) {
            try { db = JSON.parse(stored); } catch (e) { db = { customers: [] }; }
        }
        isLoading = false;
        refreshCurrentView();
    });
}

function saveData() {
    // Save to Firestore
    DB_DOC.set(JSON.parse(JSON.stringify(db))).catch(err => {
        console.error('Save error:', err);
        toast('Error saving to cloud! Check Firestore rules.', 'error');
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
}

function showDashboard() {
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
    const stats = { total: testCases.length, Pass: 0, Fail: 0, Blocked: 0, 'In Progress': 0, 'Not Executed': 0 };
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
        list.innerHTML = '<p style="padding:16px;color:var(--gray-400);font-size:13px;text-align:center;">No customers available</p>';
        return;
    }
    list.innerHTML = visible.map(c => `
        <div class="customer-item">
            <button class="customer-btn ${c.id === currentCustomerId ? 'active' : ''}" 
                    data-id="${c.id}" onclick="showCustomer('${c.id}')">
                <i class="fas fa-building"></i>
                <span>${escHtml(c.name)}</span>
                <span class="count">${c.pocs.length} POC${c.pocs.length !== 1 ? 's' : ''}</span>
            </button>
        </div>
    `).join('');
}

// ============================================================
// RENDER: DASHBOARD
// ============================================================
function renderDashboard() {
    let totalCustomers = db.customers.length;
    let totalPocs = 0, totalTCs = 0, totalPass = 0, totalFail = 0;
    db.customers.forEach(c => {
        totalPocs += c.pocs.length;
        c.pocs.forEach(p => {
            totalTCs += p.testCases.length;
            p.testCases.forEach(tc => {
                if (tc.status === 'Pass') totalPass++;
                if (tc.status === 'Fail') totalFail++;
            });
        });
    });

    const statsEl = document.getElementById('dashboardStats');
    if (statsEl) {
        statsEl.innerHTML = `
            <div class="stat-card"><div class="stat-number">${totalCustomers}</div><div class="stat-label">Customers</div></div>
            <div class="stat-card"><div class="stat-number">${totalPocs}</div><div class="stat-label">POCs</div></div>
            <div class="stat-card"><div class="stat-number">${totalTCs}</div><div class="stat-label">Test Cases</div></div>
            <div class="stat-card"><div class="stat-number" style="color:var(--success)">${totalPass}</div><div class="stat-label">Passed</div></div>
            <div class="stat-card"><div class="stat-number" style="color:var(--danger)">${totalFail}</div><div class="stat-label">Failed</div></div>
        `;
    }

    // Render Customer & POC Navigation Cards on Dashboard
    const gridEl = document.getElementById('dashboardCustomerGrid');
    if (gridEl) {
        if (db.customers.length === 0) {
            gridEl.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <i class="fas fa-building-circle-check"></i>
                    <p>No customers created yet. Click "+ Add" in sidebar or "Import Test Cases" above.</p>
                </div>`;
        } else {
            gridEl.innerHTML = db.customers.map(c => `
                <div class="customer-overview-card">
                    <div class="cust-card-header">
                        <h4 onclick="showCustomer('${c.id}')"><i class="fas fa-building" style="color:var(--primary);margin-right:8px;"></i>${escHtml(c.name)}</h4>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span class="badge badge-gray">${c.pocs.length} POC${c.pocs.length !== 1 ? 's' : ''}</span>
                            ${isAdmin ? `<button class="btn btn-outline btn-sm" onclick="event.stopPropagation(); copyCustomerLink('${c.id}')" title="Copy private customer link for ${escHtml(c.name)}"><i class="fas fa-link"></i> Link</button>` : ''}
                        </div>
                    </div>
                    <div class="poc-tag-list">
                        ${c.pocs.length === 0 ? '<p style="font-size:12px;color:var(--gray-400);">No POCs yet.</p>' : 
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
        grid.innerHTML = `<div class="empty-state"><i class="fas fa-folder-open"></i><p>No POCs yet for this customer. Click "Add POC" to create one.</p></div>`;
        return;
    }
    grid.innerHTML = customer.pocs.map(poc => {
        const stats = getTestCaseStats(poc.testCases);
        const passRate = stats.total > 0 ? Math.round((stats.Pass / stats.total) * 100) : 0;
        const progressClass = passRate >= 70 ? 'good' : passRate >= 40 ? 'medium' : 'bad';
        return `
        <div class="poc-card" onclick="showPoc('${customer.id}', '${poc.id}')">
            <h3><i class="fas fa-flask" style="color:var(--primary);margin-right:6px;"></i>${escHtml(poc.name)}</h3>
            <div class="poc-meta">
                <span><i class="fas fa-list-check"></i> ${stats.total} test cases</span>
                <span><i class="fas fa-chart-pie"></i> ${passRate}% pass rate</span>
            </div>
            <div class="progress-bar"><div class="progress-fill ${progressClass}" style="width:${passRate}%"></div></div>
            <div class="poc-stats-row">
                <span class="poc-stat-badge badge-pass">${stats.Pass} Pass</span>
                <span class="poc-stat-badge badge-fail">${stats.Fail} Fail</span>
                <span class="poc-stat-badge badge-blocked" style="background:var(--blocked-bg);color:var(--blocked)">${stats.Blocked} Blocked</span>
                <span class="poc-stat-badge badge-gray">${stats['Not Executed']} Pending</span>
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

    const statusFilter = document.getElementById('statusFilter')?.value || 'all';
    const moduleFilter = document.getElementById('moduleFilter')?.value || 'all';
    const search = (document.getElementById('searchInput')?.value || '').toLowerCase();

    let filtered = poc.testCases.filter(tc => {
        if (statusFilter !== 'all' && tc.status !== statusFilter) return false;
        if (moduleFilter !== 'all' && tc.module !== moduleFilter) return false;
        if (search) {
            const text = [tc.module, tc.scenario, tc.execStep, tc.expectedBehavior, tc.actualBehavior, tc.comment].join(' ').toLowerCase();
            if (!text.includes(search)) return false;
        }
        return true;
    });

    const tbody = document.getElementById('testCaseBody');
    const thead = document.getElementById('testCaseHead');
    const emptyMsg = document.getElementById('emptyTestCases');
    const table = document.getElementById('testCaseTable');

    if (thead) {
        thead.innerHTML = `
            <tr>
                <th class="col-no">#</th>
                <th class="col-module">Module</th>
                <th class="col-scenario">Scenario</th>
                <th class="col-step">Execution Step</th>
                <th class="col-expected">Expected Behavior</th>
                <th class="col-actual">Actual Behavior</th>
                <th class="col-comment">Comment</th>
                <th class="col-status">Status</th>
                ${isAdmin ? '<th class="col-actions">Actions</th>' : ''}
            </tr>
        `;
    }

    if (filtered.length === 0) {
        tbody.innerHTML = '';
        emptyMsg.style.display = 'block';
        table.style.display = 'none';
    } else {
        emptyMsg.style.display = 'none';
        table.style.display = 'table';
        tbody.innerHTML = filtered.map((tc) => {
            const statusClass = 'status-' + tc.status.toLowerCase().replace(/\s+/g, '-');
            return `
            <tr data-id="${tc.id}">
                <td class="col-no" style="text-align:center;font-weight:600;color:var(--gray-400)">${tc.testNo}</td>
                <td><div class="editable-cell" contenteditable="true" data-field="module" data-id="${tc.id}" onblur="onCellEdit(this)">${escHtml(tc.module)}</div></td>
                <td><div class="editable-cell" contenteditable="true" data-field="scenario" data-id="${tc.id}" onblur="onCellEdit(this)">${escHtml(tc.scenario)}</div></td>
                <td><div class="editable-cell" contenteditable="true" data-field="execStep" data-id="${tc.id}" onblur="onCellEdit(this)">${escHtml(tc.execStep)}</div></td>
                <td><div class="editable-cell" contenteditable="true" data-field="expectedBehavior" data-id="${tc.id}" onblur="onCellEdit(this)">${escHtml(tc.expectedBehavior)}</div></td>
                <td><div class="editable-cell" contenteditable="true" data-field="actualBehavior" data-id="${tc.id}" onblur="onCellEdit(this)">${escHtml(tc.actualBehavior)}</div></td>
                <td><div class="editable-cell" contenteditable="true" data-field="comment" data-id="${tc.id}" onblur="onCellEdit(this)">${escHtml(tc.comment)}</div></td>
                <td>
                    <select class="status-select ${statusClass}" data-id="${tc.id}" onchange="onStatusChange(this)">
                        <option value="Not Executed" ${tc.status === 'Not Executed' ? 'selected' : ''}>Not Executed</option>
                        <option value="In Progress" ${tc.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
                        <option value="Pass" ${tc.status === 'Pass' ? 'selected' : ''}>Pass</option>
                        <option value="Fail" ${tc.status === 'Fail' ? 'selected' : ''}>Fail</option>
                        <option value="Blocked" ${tc.status === 'Blocked' ? 'selected' : ''}>Blocked</option>
                    </select>
                </td>
                ${isAdmin ? `
                <td class="col-actions">
                    <div class="row-actions">
                        <button title="Delete Test Case" onclick="deleteTestCase('${tc.id}')"><i class="fas fa-trash"></i></button>
                    </div>
                </td>` : ''}
            </tr>`;
        }).join('');
    }

    // Stats bar update
    const allStats = getTestCaseStats(poc.testCases);
    const pocStatsEl = document.getElementById('pocStats');
    if (pocStatsEl) {
        pocStatsEl.innerHTML = `
            <span class="badge badge-pass">${allStats.Pass} Pass</span>
            <span class="badge badge-fail">${allStats.Fail} Fail</span>
            <span class="badge" style="background:var(--blocked-bg);color:var(--blocked)">${allStats.Blocked} Blocked</span>
            <span class="badge badge-info">${allStats['In Progress']} In Prog</span>
            <span class="badge badge-gray">${allStats['Not Executed']} Pending</span>
        `;
    }
    const pocBadge = document.getElementById('pocBadge');
    if (pocBadge) {
        pocBadge.textContent = `${allStats.total} test cases`;
        pocBadge.className = 'badge badge-info';
    }
}

function populateModuleFilter() {
    const poc = getPoc(currentCustomerId, currentPocId);
    const select = document.getElementById('moduleFilter');
    if (!select) return;
    const modules = [...new Set((poc?.testCases || []).map(tc => tc.module).filter(Boolean))];
    select.innerHTML = '<option value="all">All</option>' + modules.map(m => `<option value="${escHtml(m)}">${escHtml(m)}</option>`).join('');
}

// ============================================================
// INLINE EDITING
// ============================================================
function onCellEdit(el) {
    const tcId = el.dataset.id;
    const field = el.dataset.field;
    const value = el.innerText.trim();
    const poc = getPoc(currentCustomerId, currentPocId);
    if (!poc) return;
    const tc = poc.testCases.find(t => t.id === tcId);
    if (tc && tc[field] !== value) {
        tc[field] = value;
        saveData();
    }
}

function onStatusChange(el) {
    const tcId = el.dataset.id;
    const value = el.value;
    const poc = getPoc(currentCustomerId, currentPocId);
    if (!poc) return;
    const tc = poc.testCases.find(t => t.id === tcId);
    if (tc) {
        tc.status = value;
        saveData();
        renderTestCases();
    }
}

// ============================================================
// DEDICATED SEPARATE ADMIN IMPORT MENU (Upload Excel)
// ============================================================
function showAdminUploadModal() {
    if (!isAdmin) {
        toggleAdminMode();
        return;
    }
    const customerOptions = db.customers.map(c => `
        <option value="${c.id}" ${c.id === currentCustomerId ? 'selected' : ''}>${escHtml(c.name)}</option>
    `).join('');

    openModal('Import Test Cases from Excel', `
        <div class="form-group">
            <label>Target Customer</label>
            <select id="importCustomerSelect" onchange="toggleNewCustomerInput(this.value)">
                ${customerOptions}
                <option value="__NEW__">+ Create New Customer...</option>
            </select>
        </div>
        <div class="form-group" id="newCustomerGroup" style="${db.customers.length === 0 ? '' : 'display:none;'}">
            <label>New Customer Name</label>
            <input type="text" id="importNewCustomerName" placeholder="e.g. Acme Corp">
        </div>
        <div class="form-group">
            <label>Select Excel / CSV File (.xlsx, .xls, .csv)</label>
            <input type="file" id="importFileInput" accept=".xlsx,.xls,.csv" style="padding: 6px;">
            <p style="font-size:12px;color:var(--gray-500);margin-top:6px;">
                💡 <b>Multi-sheet files:</b> Each sheet becomes a POC.<br>
                💡 <b>Single sheet:</b> Uses POC column or file name as POC.
            </p>
        </div>
    `, () => {
        const select = document.getElementById('importCustomerSelect');
        const fileInput = document.getElementById('importFileInput');
        const file = fileInput.files[0];

        if (!file) {
            toast('Please choose an Excel file to upload!', 'error');
            return false;
        }

        let targetCustomer = null;
        if (select.value === '__NEW__' || db.customers.length === 0) {
            const newName = document.getElementById('importNewCustomerName').value.trim();
            if (!newName) {
                toast('Please enter a name for the new customer!', 'error');
                return false;
            }
            targetCustomer = { id: genId(), name: newName, pocs: [] };
            db.customers.push(targetCustomer);
        } else {
            targetCustomer = getCustomer(select.value);
        }

        if (!targetCustomer) {
            toast('Customer not found', 'error');
            return false;
        }

        executeExcelImport(file, targetCustomer);
        return true;
    });

    if (db.customers.length === 0) {
        document.getElementById('importCustomerSelect').value = '__NEW__';
        document.getElementById('newCustomerGroup').style.display = 'block';
    }
}

function toggleNewCustomerInput(val) {
    const grp = document.getElementById('newCustomerGroup');
    if (grp) {
        grp.style.display = val === '__NEW__' ? 'block' : 'none';
    }
}

function executeExcelImport(file, customer) {
    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const workbook = XLSX.read(e.target.result, { type: 'array' });
            let totalAdded = 0;
            let pocsCreated = 0;

            if (workbook.SheetNames.length > 1) {
                // Multi-sheet: each sheet is a POC
                workbook.SheetNames.forEach(sheetName => {
                    const sheet = workbook.Sheets[sheetName];
                    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
                    if (rows.length === 0) return;

                    const poc = createOrGetPoc(customer, sheetName.trim());
                    const colMap = detectColumns(Object.keys(rows[0]));
                    rows.forEach(row => {
                        poc.testCases.push(rowToTestCase(row, colMap, poc.testCases.length + 1));
                        totalAdded++;
                    });
                    pocsCreated++;
                });
            } else {
                // Single sheet: check for POC column
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
                if (rows.length === 0) { toast('Excel file is empty!', 'error'); return; }

                const headers = Object.keys(rows[0]);
                const colMap = detectColumns(headers);
                const pocCol = detectPocColumn(headers);

                if (pocCol) {
                    const groups = {};
                    rows.forEach(row => {
                        const pocName = String(row[pocCol] || 'Default POC').trim();
                        if (!groups[pocName]) groups[pocName] = [];
                        groups[pocName].push(row);
                    });
                    Object.entries(groups).forEach(([pocName, groupRows]) => {
                        const poc = createOrGetPoc(customer, pocName);
                        groupRows.forEach(row => {
                            poc.testCases.push(rowToTestCase(row, colMap, poc.testCases.length + 1));
                            totalAdded++;
                        });
                        pocsCreated++;
                    });
                } else {
                    const pocName = file.name.replace(/\.(xlsx|xls|csv)$/i, '').trim() || 'Imported POC';
                    const poc = createOrGetPoc(customer, pocName);
                    rows.forEach(row => {
                        poc.testCases.push(rowToTestCase(row, colMap, poc.testCases.length + 1));
                        totalAdded++;
                    });
                    pocsCreated = 1;
                }
            }

            saveData();
            showCustomer(customer.id);
            renderSidebar();
            toast(`Successfully imported ${totalAdded} test cases across ${pocsCreated} POC(s)!`, 'success');
        } catch (err) {
            console.error('Import error:', err);
            toast('Error parsing Excel: ' + err.message, 'error');
        }
    };
    reader.readAsArrayBuffer(file);
}

// --- Helpers for Excel import ---
function rowToTestCase(row, colMap, testNo) {
    return {
        id: genId(),
        testNo: testNo,
        module: String(row[colMap.module] || '').trim(),
        scenario: String(row[colMap.scenario] || '').trim(),
        execStep: String(row[colMap.execStep] || '').trim(),
        expectedBehavior: String(row[colMap.expected] || '').trim(),
        actualBehavior: String(row[colMap.actual] || '').trim(),
        comment: String(row[colMap.comment] || '').trim(),
        status: normalizeStatus(String(row[colMap.status] || 'Not Executed').trim())
    };
}

function createOrGetPoc(customer, pocName) {
    let poc = customer.pocs.find(p => p.name.toLowerCase() === pocName.toLowerCase());
    if (!poc) {
        poc = { id: genId(), name: pocName, testCases: [] };
        customer.pocs.push(poc);
    }
    return poc;
}

function detectPocColumn(headers) {
    const lower = headers.map(h => h.toLowerCase());
    const keywords = ['poc', 'proof of concept', 'project', 'poc name', 'poc_name'];
    for (const kw of keywords) {
        const idx = lower.findIndex(h => h.includes(kw));
        if (idx !== -1) return headers[idx];
    }
    return null;
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
        module:   find(['module', 'component', 'feature', 'area']) || headers[1] || '',
        scenario: find(['scenario', 'test case', 'testcase', 'description', 'title', 'name']) || headers[2] || '',
        execStep: find(['exec', 'step', 'procedure', 'action', 'steps']) || headers[3] || '',
        expected: find(['expected', 'expect']) || headers[4] || '',
        actual:   find(['actual', 'result', 'observed']) || headers[5] || '',
        comment:  find(['comment', 'note', 'remark', 'observation']) || headers[6] || '',
        status:   find(['status', 'verdict', 'outcome', 'pass', 'result']) || headers[7] || ''
    };
}

function normalizeStatus(s) {
    const l = s.toLowerCase();
    if (l.includes('pass') || l === 'p' || l === 'yes' || l === 'ok') return 'Pass';
    if (l.includes('fail') || l === 'f' || l === 'no' || l === 'nok') return 'Fail';
    if (l.includes('block')) return 'Blocked';
    if (l.includes('progress') || l.includes('wip')) return 'In Progress';
    return 'Not Executed';
}

// ============================================================
// CRUD OPERATIONS
// ============================================================

// --- Customer ---
function showAddCustomerModal() {
    openModal('Add Customer', `
        <div class="form-group">
            <label>Customer Name</label>
            <input type="text" id="modalInput1" placeholder="e.g. Acme Corp" autofocus>
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
        toast(`Customer "${name}" created! Link ready to share.`, 'success');
    });
}

function deleteCurrentCustomer() {
    if (!isAdmin) { toggleAdminMode(); return; }
    if (!currentCustomerId) return;
    const c = getCustomer(currentCustomerId);
    if (!confirm(`Delete customer "${c.name}" and ALL its POCs & test cases?`)) return;
    db.customers = db.customers.filter(c => c.id !== currentCustomerId);
    saveData();
    renderSidebar();
    showDashboard();
    toast('Customer deleted', 'info');
}

// --- POC ---
function showAddPocModal() {
    openModal('Add POC', `
        <div class="form-group">
            <label>POC Name</label>
            <input type="text" id="modalInput1" placeholder="e.g. SSO Integration POC" autofocus>
        </div>
    `, () => {
        const name = document.getElementById('modalInput1').value.trim();
        if (!name) { toast('Please enter a name', 'error'); return false; }
        const customer = getCustomer(currentCustomerId);
        customer.pocs.push({ id: genId(), name, testCases: [] });
        saveData();
        renderPocGrid();
        renderSidebar();
        toast(`POC "${name}" added!`, 'success');
    });
}

function deleteCurrentPoc() {
    if (!isAdmin) { toggleAdminMode(); return; }
    if (!currentPocId) return;
    const poc = getPoc(currentCustomerId, currentPocId);
    if (!confirm(`Delete POC "${poc.name}" and all its test cases?`)) return;
    const customer = getCustomer(currentCustomerId);
    customer.pocs = customer.pocs.filter(p => p.id !== currentPocId);
    saveData();
    showCustomer(currentCustomerId);
    renderSidebar();
    toast('POC deleted', 'info');
}

// --- Test Case ---
function showAddTestCaseModal() {
    const poc = getPoc(currentCustomerId, currentPocId);
    const nextNo = poc ? poc.testCases.length + 1 : 1;
    openModal('Add Test Case', `
        <div class="form-group"><label>Test No.</label><input type="number" id="tcNo" value="${nextNo}"></div>
        <div class="form-group"><label>Module</label><input type="text" id="tcModule" placeholder="e.g. Authentication"></div>
        <div class="form-group"><label>Scenario</label><textarea id="tcScenario" placeholder="e.g. Login with valid credentials"></textarea></div>
        <div class="form-group"><label>Execution Step</label><textarea id="tcStep" placeholder="e.g. 1. Open app  2. Enter credentials  3. Click Login"></textarea></div>
        <div class="form-group"><label>Expected Behavior</label><textarea id="tcExpected" placeholder="e.g. User is redirected to dashboard"></textarea></div>
        <div class="form-group"><label>Status</label>
            <select id="tcStatus">
                <option value="Not Executed">Not Executed</option>
                <option value="In Progress">In Progress</option>
                <option value="Pass">Pass</option>
                <option value="Fail">Fail</option>
                <option value="Blocked">Blocked</option>
            </select>
        </div>
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
            status: document.getElementById('tcStatus').value
        });
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
    poc.testCases.forEach((tc, i) => tc.testNo = i + 1);
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

    const data = poc.testCases.map(tc => ({
        'Test No.': tc.testNo,
        'Module': tc.module,
        'Scenario': tc.scenario,
        'Execution Step': tc.execStep,
        'Expected Behavior': tc.expectedBehavior,
        'Actual Behavior': tc.actualBehavior,
        'Comment': tc.comment,
        'Status': tc.status
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [
        { wch: 8 }, { wch: 15 }, { wch: 30 }, { wch: 35 },
        { wch: 30 }, { wch: 30 }, { wch: 20 }, { wch: 14 }
    ];
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
            if (!confirm(`This will REPLACE all current data with the backup (${imported.customers.length} customers). Continue?`)) return;
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
