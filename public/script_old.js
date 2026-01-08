const token = localStorage.getItem('token');
// Se não tem token, manda pro login.
if (!token) window.location.href = '/login.html';

const authFetch = async (url, options = {}) => {
    const headers = {'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...options.headers};
    try {
        const res = await fetch(url, { ...options, headers });
        if (res.status === 401 || res.status === 403) {
            localStorage.removeItem('token');
            window.location.href = '/login.html'; return null;
        }
        return res;
    } catch (err) { console.error("Erro de conexão:", err); return null; }
};

const formatBRL = (c) => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(c/100);
const formatDate = (d) => { if(!d)return''; const[y,m,x]=d.split('-'); return `${x}/${m}/${y}`; };

let globalCategories = [];
let categoryChartInstance = null;
let monthlyChartInstance = null;

// INICIALIZAÇÃO SEGURA
document.addEventListener('DOMContentLoaded', () => {
    init();
    setupEventListeners();
});

async function init() {
    console.log("Iniciando sistema...");

    // PREENCHE OS SELECTS DE DATA (PT-BR) SE EXISTIREM
    const monthsPT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const mSel = document.getElementById('filterMonthSelect');
    const ySel = document.getElementById('filterYearSelect');
    
    if(mSel && ySel && mSel.options.length === 0) {
        const today = new Date();
        monthsPT.forEach((m, i) => {
            const opt = document.createElement('option');
            opt.value = (i + 1).toString().padStart(2, '0');
            opt.text = m;
            mSel.appendChild(opt);
        });
        mSel.value = (today.getMonth() + 1).toString().padStart(2, '0');

        const currYear = today.getFullYear();
        for(let y = currYear - 2; y <= currYear + 2; y++){
            const opt = document.createElement('option'); opt.value = y; opt.text = y; ySel.appendChild(opt);
        }
        ySel.value = currYear;
    }

    try {
        await loadCategories();
        await loadDashboard();
    } catch (e) {
        console.error("Erro fatal na inicialização:", e);
    }
}

function setupEventListeners() {
    // Navegação de Abas
    window.switchTab = (t) => { 
        document.querySelectorAll('.view-section').forEach(v=>v.style.display='none'); 
        const target = document.getElementById(t+'View');
        if(target) target.style.display='block';
        
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        // Tenta ativar o botão visualmente (seguro)
        const btnOverview = document.querySelector('.nav-btn:first-child');
        const btnReports = document.querySelector('.nav-btn:nth-child(2)');
        if(t === 'dashboard' && btnOverview) btnOverview.classList.add('active');
        if(t === 'reports' && btnReports) btnReports.classList.add('active');

        if(t==='reports') loadCharts(); 
    };

    // Logout
    const btnLogout = document.getElementById('logoutBtn');
    if(btnLogout) btnLogout.addEventListener('click', () => {
        if(confirm("Deseja realmente sair?")) { localStorage.removeItem('token'); window.location.href='/login.html'; }
    });

    // Modal Perfil
    const modalProfile = document.getElementById('profileModal');
    const userWidget = document.getElementById('userWidget');
    if(userWidget && modalProfile) userWidget.addEventListener('click', () => modalProfile.classList.add('active'));
    
    const closeProf = document.getElementById('closeProfileModal');
    if(closeProf) closeProf.addEventListener('click', () => modalProfile.classList.remove('active'));
    
    const profForm = document.getElementById('profileForm');
    if(profForm) {
        profForm.addEventListener('submit', async(e)=>{
            e.preventDefault(); 
            const editUser = document.getElementById('editUsername');
            const editPass = document.getElementById('editPassword');
            if(!editUser) return;

            const res=await authFetch('/api/user', {method:'PUT', body:JSON.stringify({username:editUser.value, newPassword:editPass ? editPass.value : ''})});
            if(res.ok){ alert("Salvo!"); modalProfile.classList.remove('active'); if(editPass) editPass.value=''; loadDashboard(); }
        });
    }

    // Modal Categoria
    const modalCat = document.getElementById('catModal');
    const openCat = document.getElementById('openCatModal');
    if(openCat && modalCat) openCat.addEventListener('click', () => modalCat.classList.add('active'));
    
    const closeCat = document.getElementById('closeCatModal');
    if(closeCat) closeCat.addEventListener('click', () => modalCat.classList.remove('active'));

    const formCat = document.getElementById('newCatForm');
    if(formCat) formCat.addEventListener('submit', async (e) => {
        e.preventDefault();
        const nameEl = document.getElementById('newCatName');
        const typeEl = document.getElementById('newCatType');
        await authFetch('/api/categories', {method:'POST', body:JSON.stringify({name: nameEl.value, type: typeEl.value})});
        nameEl.value = '';
        await loadCategories();
        alert(`Categoria adicionada!`);
    });

    // Contas e Transações
    const btnToggleAcc = document.getElementById('toggleAccBtn');
    if(btnToggleAcc) btnToggleAcc.addEventListener('click', () => document.getElementById('accountForm').classList.toggle('active'));

    const formAcc = document.getElementById('accountForm');
    if(formAcc) formAcc.addEventListener('submit', async(e)=>{
        e.preventDefault(); 
        await authFetch('/api/accounts', {method:'POST', body:JSON.stringify({name:document.getElementById('accName').value, initial_balance:document.getElementById('accBalance').value})}); 
        formAcc.reset(); 
        loadDashboard();
    });

    const typeEl = document.getElementById('type');
    if(typeEl) typeEl.addEventListener('change', updateCategoryDropdown);

    const formTrans = document.getElementById('transactionForm');
    if(formTrans) formTrans.addEventListener('submit', async(e)=>{
        e.preventDefault(); 
        const aid=document.getElementById('accountSelect').value; 
        if(!aid) return alert("Selecione uma conta!");
        await authFetch('/api/transactions', {method:'POST', body:JSON.stringify({
            date:document.getElementById('date').value, account_id:aid, description:document.getElementById('desc').value, 
            type:document.getElementById('type').value, category:document.getElementById('category').value, amount:document.getElementById('amount').value
        })}); 
        document.getElementById('desc').value=''; document.getElementById('amount').value=''; loadDashboard();
    });
    
    const dateInput = document.getElementById('date');
    if(dateInput) dateInput.valueAsDate = new Date();
}

// --- LÓGICA DE DADOS ---

async function loadCategories() {
    const res = await authFetch('/api/categories');
    if(!res || !res.ok) return; // Evita crash se API falhar
    const json = await res.json();
    globalCategories = json.data || [];
    
    const list = document.getElementById('catListDisplay');
    if(list) {
        list.innerHTML = '';
        globalCategories.forEach(c => {
            const typeLabel = c.type === 'INCOME' ? '<b style="color:#10b981">Receita</b>' : '<b style="color:#ef4444">Despesa</b>';
            list.innerHTML += `<li><span>${c.name} <small>(${typeLabel})</small></span> <button onclick="deleteCategory(${c.id})" class="btn-xs">&times;</button></li>`;
        });
    }

    const filterSel = document.getElementById('filterCategory');
    if(filterSel) {
        const savedFilter = filterSel.value;
        filterSel.innerHTML = '<option value="Todas">Todas Categorias</option>';
        globalCategories.forEach(c => {
            if(!filterSel.querySelector(`option[value="${c.name}"]`)){
                const opt = document.createElement('option'); opt.value = c.name; opt.text = c.name; filterSel.appendChild(opt);
            }
        });
        filterSel.value = savedFilter;
    }
    updateCategoryDropdown();
}

function updateCategoryDropdown() {
    const typeEl = document.getElementById('type');
    const formSel = document.getElementById('category');
    if(!typeEl || !formSel) return;

    const currentType = typeEl.value; 
    formSel.innerHTML = ''; 
    const filtered = globalCategories.filter(c => c.type === currentType);
    if (filtered.length === 0) formSel.innerHTML = '<option disabled selected>Nenhuma categoria</option>';
    else filtered.forEach(c => { const opt = document.createElement('option'); opt.value = c.name; opt.text = c.name; formSel.appendChild(opt); });
}

async function loadDashboard() {
    console.log("Carregando dashboard...");
    
    // 1. User
    const rUser = await authFetch('/api/user');
    if(rUser && rUser.ok) {
        const u = await rUser.json();
        const displayUser = document.getElementById('displayUsername');
        const editUser = document.getElementById('editUsername');
        if(displayUser) displayUser.innerText = u.username;
        if(editUser) editUser.value = u.username;
    }

    // 2. Accounts
    const rAcc = await authFetch('/api/accounts');
    if(rAcc && rAcc.ok) {
        const accData = await rAcc.json();
        const accList = document.getElementById('accountsList');
        const accSelect = document.getElementById('accountSelect');
        
        if(accList) accList.innerHTML = '';
        const sv = accSelect ? accSelect.value : '';
        if(accSelect) accSelect.innerHTML = '<option value="" disabled selected>Selecione...</option>';
        
        if(accData.data) accData.data.forEach(acc => {
            if(accList) accList.innerHTML += `<div class="acc-card"><h4>${acc.name}</h4><div class="acc-balance">${formatBRL(acc.current_balance)}</div></div>`;
            if(accSelect) {
                const opt = document.createElement('option'); opt.value=acc.id; opt.text=acc.name; accSelect.appendChild(opt);
            }
        });
        if(accSelect && sv) accSelect.value = sv;
    }

    // 3. Balance
    const rGlob = await authFetch('/api/global-balance');
    if(rGlob && rGlob.ok) {
        const balDisplay = document.getElementById('globalBalanceDisplay');
        if(balDisplay) balDisplay.innerText = formatBRL((await rGlob.json()).total);
    }

    // 4. Transactions
    const mSel = document.getElementById('filterMonthSelect');
    const ySel = document.getElementById('filterYearSelect');
    const cSel = document.getElementById('filterCategory');
    
    // Fallback seguro se os filtros ainda não existirem
    const m = mSel ? mSel.value : (new Date().getMonth()+1).toString().padStart(2,'0');
    const y = ySel ? ySel.value : new Date().getFullYear();
    const cat = cSel ? cSel.value : 'Todas';
    const monthString = `${y}-${m}`;
    
    const rTrans = await authFetch(`/api/transactions?month=${monthString}&category=${cat}`);
    if(rTrans && rTrans.ok) {
        const tData = await rTrans.json();
        const tList = document.getElementById('transactionList');
        if(tList) {
            tList.innerHTML = '';
            if(!tData.data || tData.data.length === 0) tList.innerHTML = '<li style="justify-content:center;color:#999">Sem lançamentos.</li>';
            else tData.data.forEach(i => {
                tList.innerHTML += `<li>
                    <div class="t-info"><span class="t-desc">${i.description}</span><div class="t-meta"><span>${formatDate(i.date)}</span><span class="badge">${i.category}</span></div></div>
                    <div class="t-amount ${i.type==='INCOME'?'plus':'minus'}">${i.type==='EXPENSE'?'-':'+'} ${formatBRL(i.amount)}</div>
                </li>`;
            });
        }
    }

    if(document.getElementById('reportsView') && document.getElementById('reportsView').style.display !== 'none') loadCharts();
}

window.deleteCategory = async (id) => { if(confirm("Remover?")) { await authFetch(`/api/categories/${id}`, {method:'DELETE'}); await loadCategories(); }};

async function loadCharts(){
    try {
        const ctxCat = document.getElementById('categoryChart');
        const ctxMon = document.getElementById('monthlyChart');
        if(!ctxCat || !ctxMon) return; // Se não tem canvas, para.

        const rCat=await authFetch('/api/reports/category'); 
        if(rCat && rCat.ok) {
            const dCat=await rCat.json();
            const c1=ctxCat.getContext('2d'); 
            if(categoryChartInstance)categoryChartInstance.destroy();
            categoryChartInstance=new Chart(c1,{type:'doughnut',data:{labels:dCat.data.map(d=>d.category),datasets:[{data:dCat.data.map(d=>d.total/100),backgroundColor:['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6']}]},options:{maintainAspectRatio:false}});
        }

        const rMon=await authFetch('/api/reports/monthly'); 
        if(rMon && rMon.ok) {
            const dMon=await rMon.json();
            const c2=ctxMon.getContext('2d'); 
            if(monthlyChartInstance)monthlyChartInstance.destroy();
            monthlyChartInstance=new Chart(c2,{type:'bar',data:{labels:dMon.data.map(d=>d.month),datasets:[{label:'Entradas',data:dMon.data.map(d=>d.income/100),backgroundColor:'#10b981'},{label:'Saídas',data:dMon.data.map(d=>d.expense/100),backgroundColor:'#ef4444'}]},options:{maintainAspectRatio:false,scales:{y:{beginAtZero:true}}}});
        }
    } catch(e) { console.error("Erro gráfico:", e); }
}