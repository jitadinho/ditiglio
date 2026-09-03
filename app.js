(() => {
  'use strict';
  const cfg = window.DITIGLIO_CONFIG || {};
  const app = document.getElementById('app');
  const configured = cfg.supabaseUrl && cfg.supabaseKey && !cfg.supabaseUrl.includes('SEU-PROJETO');
  if (!configured) {
    app.innerHTML = `<main class="center-page"><section class="message-card"><img src="logo-ditiglio.png" alt="Di Tiglio"><p class="eyebrow">Configuração necessária</p><h1>Conecte o Supabase.</h1><p>Abra o arquivo <b>config.js</b> e preencha a URL e a chave publicável/anon do seu projeto.</p></section></main>`;
    return;
  }

  const api = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
  const services = ['Corte', 'Barba', 'Corte + barba', 'Acabamento', 'Outro serviço'];
  let session = null;
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const shortTime = value => String(value || '').slice(0, 5);
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
  const page = () => location.hash.startsWith('#barbeiro') ? 'barbeiro' : 'inicio';
  const setNotice = (id, text, error = false) => { const el = document.getElementById(id); if (el) { el.textContent = text; el.className = error ? 'notice error' : 'notice'; } };

  function slotsFor(barber) {
    const minutes = value => { const [h, m] = shortTime(value).split(':').map(Number); return h * 60 + m; };
    const format = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
    const values = [];
    for (let value = minutes(barber.work_start); value + barber.slot_minutes <= minutes(barber.work_end); value += barber.slot_minutes) values.push(format(value));
    return values;
  }

  function shell() {
    return `<header class="site-header"><a href="#inicio"><img src="logo-ditiglio.png" alt="Di Tiglio Barber Club"></a><nav><a href="#agendar">Agendar horário</a><a class="outline-button" href="#barbeiro">Sou barbeiro</a></nav></header>
      <section class="hero"><div class="hero-copy"><p class="eyebrow">Sua melhor versão começa aqui</p><h1>Seu estilo.<br><em>Seu horário.</em></h1><p>Escolha seu barbeiro, encontre o melhor horário e confirme seu atendimento.</p><a class="primary-button" href="#agendar">Agendar agora <span>→</span></a></div><div class="hero-art"><img src="logo-ditiglio.png" alt="Di Tiglio Barber Club"><div class="open-card"><span>● Agenda aberta</span><strong>Escolha seu horário</strong><small>Confirmação em poucos segundos</small></div></div></section>
      <section class="booking-section" id="agendar"><div class="section-heading"><div><p class="eyebrow">Agendamento online</p><h2>Reserve seu momento</h2></div><p>Folgas e horários ocupados são bloqueados automaticamente.</p></div><div id="booking-root" class="booking-shell"><div class="booking-panel">Carregando profissionais…</div></div></section>
      <footer><img src="ditiglio-logo-branca.png" alt="Di Tiglio"><p>Agendamento simples. Atendimento impecável.</p></footer>`;
  }

  async function renderHome() {
    app.innerHTML = shell();
    const root = document.getElementById('booking-root');
    const { data: barbers, error } = await api.from('barbers').select('id,name,specialty,work_start,work_end,slot_minutes,active').eq('active', true).order('name');
    if (error) { root.innerHTML = `<div class="booking-panel"><p class="notice error">${escapeHtml(error.message)}</p></div>`; return; }
    if (!barbers.length) { root.innerHTML = `<div class="booking-panel"><p>Nenhum barbeiro cadastrado.</p></div>`; return; }
    root.innerHTML = `<div class="booking-panel"><label>Profissional<select id="barber-select">${barbers.map(b => `<option value="${b.id}">${escapeHtml(b.name)} — ${escapeHtml(b.specialty)}</option>`).join('')}</select></label><label>Data<input id="booking-date" type="date" min="${today()}" value="${today()}"></label><div><span class="field-label">Horários disponíveis</span><div id="availability" class="time-grid"></div></div></div>
      <form id="booking-form" class="booking-panel booking-form"><label>Seu nome<input name="name" required minlength="2" placeholder="Nome completo"></label><label>Telefone<input name="phone" required minlength="8" placeholder="(00) 00000-0000"></label><label>O que você vai fazer?<select name="service">${services.map(s => `<option>${s}</option>`).join('')}</select></label><div class="booking-summary"><span>Horário escolhido</span><strong id="chosen-time">—</strong></div><button class="primary-button" type="submit" disabled>Confirmar agendamento <span>→</span></button><p id="booking-notice" class="notice"></p></form>`;
    let chosen = '';
    const barberSelect = document.getElementById('barber-select');
    const dateInput = document.getElementById('booking-date');
    const availability = document.getElementById('availability');
    const form = document.getElementById('booking-form');
    const submit = form.querySelector('button[type=submit]');
    async function loadAvailability() {
      chosen = ''; document.getElementById('chosen-time').textContent = '—'; submit.disabled = true; availability.innerHTML = 'Carregando…';
      const barber = barbers.find(item => item.id === barberSelect.value);
      const [off, booked] = await Promise.all([
        api.from('barber_days_off').select('id').eq('barber_id', barber.id).eq('off_date', dateInput.value).maybeSingle(),
        api.rpc('get_booked_slots', { p_barber_id: barber.id, p_date: dateInput.value })
      ]);
      if (off.data) { availability.innerHTML = '<p class="off-banner">Este profissional está de folga nesta data.</p>'; return; }
      const occupied = (booked.data || []).map(item => shortTime(item.appointment_time));
      const available = slotsFor(barber).filter(value => !occupied.includes(value));
      availability.innerHTML = available.length ? available.map(value => `<button type="button" data-time="${value}">${value}</button>`).join('') : '<p>Não há horários disponíveis.</p>';
      availability.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
        availability.querySelectorAll('button').forEach(item => item.classList.remove('selected')); button.classList.add('selected'); chosen = button.dataset.time; document.getElementById('chosen-time').textContent = chosen; submit.disabled = false;
      }));
    }
    barberSelect.addEventListener('change', loadAvailability); dateInput.addEventListener('change', loadAvailability); await loadAvailability();
    form.addEventListener('submit', async event => {
      event.preventDefault(); const values = new FormData(form); submit.disabled = true;
      const { error: bookingError } = await api.rpc('create_appointment', { p_barber_id: barberSelect.value, p_customer_name: values.get('name'), p_customer_phone: values.get('phone'), p_service: values.get('service'), p_date: dateInput.value, p_time: chosen });
      if (bookingError) { setNotice('booking-notice', bookingError.message, true); submit.disabled = false; return; }
      setNotice('booking-notice', `Agendamento confirmado para ${dateInput.value.split('-').reverse().join('/')} às ${chosen}.`); form.reset(); dateInput.value = today(); await loadAvailability();
    });
  }

  function authTemplate(mode = 'login') {
    const register = mode === 'register';
    return `<main class="auth-page"><section class="auth-card"><div class="auth-brand"><a href="#inicio"><img src="ditiglio-logo-branca.png" alt="Di Tiglio"></a></div><div class="auth-content"><p class="eyebrow">Acesso do barbeiro</p><h1>${register ? 'Crie seu cadastro.' : 'Entre na sua agenda.'}</h1><div class="auth-tabs"><button data-mode="login" class="${register ? '' : 'active'}">Entrar</button><button data-mode="register" class="${register ? 'active' : ''}">Cadastrar</button></div><form id="auth-form" class="profile-form">${register ? `<label>Nome completo<input name="name" required minlength="2"></label><label>Especialidade<input name="specialty" required placeholder="Ex.: Degradê e barba"></label><div class="form-row"><label>Início<input name="workStart" type="time" value="09:00" required></label><label>Fim<input name="workEnd" type="time" value="18:00" required></label></div><label>Duração<select name="slotMinutes"><option value="30">30 minutos</option><option value="45">45 minutos</option><option value="60" selected>1 hora</option><option value="90">1 hora e 30</option></select></label>` : ''}<label>E-mail<input name="email" type="email" required></label><label>Senha<input name="password" type="password" required minlength="8"></label><button class="primary-button">${register ? 'Criar cadastro' : 'Entrar'} <span>→</span></button><p id="auth-notice" class="notice"></p></form><a class="back-link" href="#inicio">← Voltar ao agendamento</a></div></section></main>`;
  }

  function renderAuth(mode = 'login') {
    app.innerHTML = authTemplate(mode);
    document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => renderAuth(button.dataset.mode)));
    document.getElementById('auth-form').addEventListener('submit', async event => {
      event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); const button = form.querySelector('button'); button.disabled = true;
      if (mode === 'login') {
        const { error } = await api.auth.signInWithPassword({ email: values.get('email'), password: values.get('password') });
        if (error) { setNotice('auth-notice', 'E-mail ou senha inválidos.', true); button.disabled = false; }
      } else {
        const { error } = await api.auth.signUp({ email: values.get('email'), password: values.get('password'), options: { emailRedirectTo: `${location.origin}${location.pathname}#barbeiro`, data: { name: values.get('name'), specialty: values.get('specialty'), work_start: values.get('workStart'), work_end: values.get('workEnd'), slot_minutes: Number(values.get('slotMinutes')) } } });
        setNotice('auth-notice', error ? error.message : 'Cadastro criado. Confira seu e-mail para confirmar a conta.', Boolean(error)); button.disabled = false;
      }
    });
  }

  async function renderPortal() {
    if (!session) { renderAuth(); return; }
    app.innerHTML = '<main class="center-page">Carregando sua agenda…</main>';
    const { data } = await api.from('user_roles').select('role').eq('user_id', session.user.id).single();
    const admin = data && data.role === 'admin';
    app.innerHTML = `<main class="portal-page"><header class="portal-header"><a href="#inicio"><img src="ditiglio-logo-branca.png" alt="Di Tiglio"><span>${admin ? 'PAINEL ADMINISTRATIVO' : 'PORTAL DO BARBEIRO'}</span></a><div><span>${escapeHtml(session.user.email)}</span><button id="logout">Sair</button></div></header><div id="portal-root" class="portal-content">Carregando…</div></main>`;
    document.getElementById('logout').addEventListener('click', () => api.auth.signOut());
    if (admin) await renderAdmin(); else await renderBarber();
  }

  async function renderBarber(date = today()) {
    const root = document.getElementById('portal-root'); const userId = session.user.id;
    const [profileResult, appointmentResult, offResult] = await Promise.all([
      api.from('barbers').select('*').eq('id', userId).single(), api.from('appointments').select('*').eq('barber_id', userId).eq('appointment_date', date).order('appointment_time'), api.from('barber_days_off').select('id').eq('barber_id', userId).eq('off_date', date).maybeSingle()
    ]);
    const profile = profileResult.data; if (!profile) { root.innerHTML = '<p class="notice error">Perfil não encontrado. Confirme seu e-mail e entre novamente.</p>'; return; }
    const items = appointmentResult.data || []; const dayOffId = offResult.data && offResult.data.id;
    root.innerHTML = `<div class="portal-title"><div><p class="eyebrow">Minha agenda</p><h1>Olá, ${escapeHtml(profile.name.split(' ')[0])}.</h1></div></div><section class="toolbar"><label>Escolha o dia<input id="portal-date" type="date" value="${date}"></label><div><strong>${items.length}</strong><span>clientes agendados</span></div><button id="day-off" class="${dayOffId ? 'work-button' : 'off-button'}">${dayOffId ? 'Voltar a trabalhar neste dia' : 'Marcar folga neste dia'}</button></section><p id="portal-notice" class="notice"></p><section class="portal-grid"><div class="appointments"><h2>Atendimentos</h2>${dayOffId ? '<p class="off-banner">Você está de folga neste dia.</p>' : ''}${items.length ? items.map(item => `<article><time>${shortTime(item.appointment_time)}</time><div><strong>${escapeHtml(item.customer_name)}</strong><a href="tel:${escapeHtml(item.customer_phone)}">${escapeHtml(item.customer_phone)}</a></div><span>${escapeHtml(item.service)}</span></article>`).join('') : '<div class="empty-state">Agenda livre para este dia.</div>'}</div><form id="profile-form" class="profile-card profile-form"><h2>Perfil profissional</h2><label>Nome<input name="name" value="${escapeHtml(profile.name)}" required></label><label>Especialidade<input name="specialty" value="${escapeHtml(profile.specialty)}" required></label><div class="form-row"><label>Início<input name="workStart" type="time" value="${shortTime(profile.work_start)}"></label><label>Fim<input name="workEnd" type="time" value="${shortTime(profile.work_end)}"></label></div><label>Duração<select name="slotMinutes">${[30,45,60,90].map(value => `<option value="${value}" ${value === profile.slot_minutes ? 'selected' : ''}>${value} min</option>`).join('')}</select></label><button class="primary-button">Salvar perfil</button></form></section>`;
    document.getElementById('portal-date').addEventListener('change', event => renderBarber(event.target.value));
    document.getElementById('day-off').addEventListener('click', async () => { const result = dayOffId ? await api.from('barber_days_off').delete().eq('id', dayOffId) : await api.from('barber_days_off').insert({ barber_id: userId, off_date: date }); if (result.error) setNotice('portal-notice', result.error.message, true); else await renderBarber(date); });
    document.getElementById('profile-form').addEventListener('submit', async event => { event.preventDefault(); const values = new FormData(event.currentTarget); const { error } = await api.from('barbers').update({ name: values.get('name'), specialty: values.get('specialty'), work_start: values.get('workStart'), work_end: values.get('workEnd'), slot_minutes: Number(values.get('slotMinutes')) }).eq('id', userId); if (error) setNotice('portal-notice', error.message, true); else await renderBarber(date); });
  }

  async function renderAdmin(date = today()) {
    const root = document.getElementById('portal-root');
    const [barberResult, appointmentResult, offResult] = await Promise.all([api.from('barbers').select('*').order('name'), api.from('appointments').select('*').eq('appointment_date', date).order('appointment_time'), api.from('barber_days_off').select('barber_id').eq('off_date', date)]);
    const barbers = barberResult.data || []; const appointments = appointmentResult.data || []; const offIds = (offResult.data || []).map(item => item.barber_id);
    root.innerHTML = `<div class="portal-title"><div><p class="eyebrow">Visão administrativa</p><h1>Agenda da equipe</h1></div><label>Data<input id="admin-date" type="date" value="${date}"></label></div><div class="admin-summary"><div><strong>${barbers.length}</strong><span>barbeiros cadastrados</span></div><div><strong>${appointments.length}</strong><span>atendimentos no dia</span></div><div><strong>${offIds.length}</strong><span>profissionais de folga</span></div></div><section class="schedule-board">${barbers.map(barber => { const items = appointments.filter(item => item.barber_id === barber.id); const off = offIds.includes(barber.id); return `<article class="schedule-card ${off ? 'is-off' : ''}"><header><div><h2>${escapeHtml(barber.name)}</h2><p>${escapeHtml(barber.specialty)}</p></div><span>${off ? 'DE FOLGA' : `${items.length} AGENDADOS`}</span></header>${items.length ? items.map(item => `<div class="appointment-row"><time>${shortTime(item.appointment_time)}</time><div><strong>${escapeHtml(item.customer_name)}</strong><small>${escapeHtml(item.customer_phone)}</small></div><span>${escapeHtml(item.service)}</span></div>`).join('') : '<p class="empty-state">Nenhum atendimento neste dia.</p>'}</article>`; }).join('')}</section>`;
    document.getElementById('admin-date').addEventListener('change', event => renderAdmin(event.target.value));
  }

  async function render() { page() === 'barbeiro' ? await renderPortal() : await renderHome(); }
  addEventListener('hashchange', render);
  api.auth.getSession().then(({ data }) => { session = data.session; render(); });
  api.auth.onAuthStateChange((_event, next) => { session = next; if (page() === 'barbeiro') render(); });
  if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => undefined));
})();
