/* ==========================================================================
   Di Tiglio Barber Club — aplicação
   Estrutura: config → helpers → estado → views públicas → conta do cliente
              → portal do barbeiro → painel admin → roteador
   ========================================================================== */
(() => {
  'use strict';

  const cfg = window.DITIGLIO_CONFIG || {};
  const app = document.getElementById('app');
  const configured = cfg.supabaseUrl && cfg.supabaseKey && !String(cfg.supabaseUrl).includes('SEU-PROJETO');

  if (!configured) {
    app.innerHTML = `<main class="center-page"><section class="message-card">
      <img src="logo-ditiglio.png" alt="Di Tiglio">
      <p class="eyebrow">Configuração necessária</p>
      <h1>Conecte o Supabase.</h1>
      <p>Abra o arquivo <b>config.js</b> e preencha a URL e a chave publicável/anon do seu projeto.</p>
    </section></main>`;
    return;
  }

  const api = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);

  /* ------------------------------------------------------------ helpers -- */

  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const hhmm = v => String(v || '').slice(0, 5);
  const brl = cents => (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const br = iso => String(iso || '').split('-').reverse().join('/');
  const duration = m => m >= 60 ? (m % 60 ? `${Math.floor(m / 60)}h${m % 60}` : `${Math.floor(m / 60)}h`) : `${m} min`;

  const weekday = iso => {
    const [y, m, d] = String(iso).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'UTC' });
  };

  const onlyDigits = v => String(v || '').replace(/\D/g, '');
  const waLink = (phone, text) => {
    let n = onlyDigits(phone);
    if (n.length <= 11) n = '55' + n;
    return `https://wa.me/${n}?text=${encodeURIComponent(text || '')}`;
  };

  const statusLabel = {
    confirmed: 'Confirmado', pending_payment: 'Aguardando sinal',
    cancelled: 'Cancelado', completed: 'Concluído', no_show: 'Não compareceu'
  };

  const notice = (id, text, kind = '') => {
    const el = document.getElementById(id);
    if (el) { el.textContent = text; el.className = `notice ${kind}`; }
  };

  const on = (sel, evt, fn, root = document) =>
    root.querySelectorAll(sel).forEach(el => el.addEventListener(evt, fn));

  const bind = (id, evt, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(evt, fn);
  };

  /* -------------------------------------------------------------- estado -- */

  const state = {
    session: null,
    role: null,          // 'admin' | 'barber' | 'customer' | null
    customer: null,
    settings: null,
    services: [],
    barbers: [],
    plans: []
  };

  const booking = { serviceId: null, barberId: null, date: today(), time: null, coupon: '', notes: '' };

  async function loadReference(force = false) {
    if (state.settings && !force) return;
    const [s, sv, b, p] = await Promise.all([
      api.from('settings').select('*').eq('id', 1).maybeSingle(),
      api.from('services').select('*').eq('active', true).order('sort_order'),
      api.from('barbers').select('*').eq('active', true).order('name'),
      api.from('plans').select('*').eq('active', true).order('sort_order')
    ]);
    state.settings = s.data || { deposit_percent: 40, payments_enabled: false, min_cancel_hours: 2, shop_phone: '' };
    state.services = sv.data || [];
    state.barbers = b.data || [];
    state.plans = p.data || [];
  }

  async function loadIdentity() {
    state.role = null; state.customer = null;
    if (!state.session) return;
    const uid = state.session.user.id;
    const [r, c] = await Promise.all([
      api.from('user_roles').select('role').eq('user_id', uid).maybeSingle(),
      api.from('customers').select('*').eq('id', uid).maybeSingle()
    ]);
    state.role = r.data ? r.data.role : null;
    state.customer = c.data || null;
  }

  /* ================================================== layout público ====== */

  function header(active) {
    const account = state.customer
      ? `<a href="#conta" class="${active === 'conta' ? 'is-active' : ''}">Minha conta</a>`
      : `<a href="#entrar">Entrar</a>`;
    return `<header class="site-header">
      <a class="brand" href="#inicio"><img src="logo-ditiglio.png" alt="Di Tiglio Barber Club"></a>
      <nav>
        <a class="hide-sm" href="#inicio">Agendar</a>
        <a href="#planos">Planos</a>
        ${account}
        <a class="ghost-button" href="#barbeiro">Sou barbeiro</a>
      </nav>
    </header>`;
  }

  function footer() {
    const phone = state.settings && state.settings.shop_phone;
    return `<footer>
      <img src="ditiglio-logo-branca.png" alt="Di Tiglio">
      <p>Agendamento simples. Atendimento impecável.</p>
      <nav>
        <a href="#inicio">Agendar</a>
        <a href="#planos">Planos</a>
        ${phone ? `<a href="${waLink(phone, 'Olá! Vim pelo site da Di Tiglio.')}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
      </nav>
    </footer>`;
  }

  const shell = (inner, active) => `${header(active)}${inner}${footer()}`;

  /* =========================================================== início ==== */

  async function renderHome() {
    await loadReference();
    app.innerHTML = shell(`
      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow">Sua melhor versão começa aqui</p>
          <h1>Seu estilo.<br><em>Seu horário.</em></h1>
          <p>Escolha o serviço, o profissional e o melhor horário. A agenda já considera folgas, almoço e atendimentos em andamento.</p>
          <a class="primary-button" href="#agendar">Agendar agora <span>→</span></a>
        </div>
        <div class="hero-art">
          <img src="logo-ditiglio.png" alt="Di Tiglio Barber Club">
          <div class="badge-card">
            <span>● Agenda aberta</span>
            <strong>Confirmação imediata</strong>
            <small>Cancele ou remarque pela sua conta.</small>
          </div>
        </div>
      </section>

      <section class="section" id="agendar">
        <div class="section-heading">
          <div><p class="eyebrow">Agendamento online</p><h2>Reserve seu momento</h2></div>
          <p>O horário começa pelo serviço: cada um tem a própria duração, e só aparecem os encaixes que cabem de verdade na agenda.</p>
        </div>
        <div id="wizard" class="wizard"></div>
      </section>`, 'inicio');

    renderWizard();
  }

  /* --------------------------------------------------- assistente (wizard) */

  function wizardStep() {
    if (!booking.serviceId) return 1;
    if (!booking.barberId) return 2;
    if (!booking.time) return 3;
    return 4;
  }

  function stepsBar(current) {
    const labels = [
      ['Passo 1', 'Serviço'],
      ['Passo 2', 'Profissional'],
      ['Passo 3', 'Data e horário'],
      ['Passo 4', 'Confirmação']
    ];
    return `<div class="steps">${labels.map((l, i) => {
      const n = i + 1;
      const cls = n === current ? 'current' : (n < current ? 'done' : '');
      return `<div class="${cls}">${l[0]}<b>${l[1]}</b></div>`;
    }).join('')}</div>`;
  }

  function renderWizard() {
    const root = document.getElementById('wizard');
    if (!root) return;
    const step = wizardStep();
    root.innerHTML = stepsBar(step) + `<div class="wizard-body" id="wizard-body"></div>`;
    const body = document.getElementById('wizard-body');

    if (step === 1) return stepService(body);
    if (step === 2) return stepBarber(body);
    if (step === 3) return stepDateTime(body);
    return stepConfirm(body);
  }

  function stepService(body) {
    if (!state.services.length) {
      body.innerHTML = `<p class="empty-state">Nenhum serviço cadastrado ainda.</p>`;
      return;
    }
    body.innerHTML = `<div>
        <p class="eyebrow">O que você vai fazer hoje?</p>
        <div class="choice-grid">${state.services.map(s => `
          <button type="button" class="choice-card" data-service="${s.id}">
            <strong>${esc(s.name)}</strong>
            <small>${esc(s.description)}</small>
            <div class="meta"><span>${duration(s.duration_minutes)}</span><b>${brl(s.price_cents)}</b></div>
          </button>`).join('')}</div>
      </div>`;
    on('[data-service]', 'click', e => {
      booking.serviceId = e.currentTarget.dataset.service;
      booking.barberId = null; booking.time = null;
      renderWizard();
    }, body);
  }

  function stepBarber(body) {
    const service = state.services.find(s => s.id === booking.serviceId);
    if (!state.barbers.length) {
      body.innerHTML = `<p class="empty-state">Nenhum profissional disponível.</p>`;
      return;
    }
    body.innerHTML = `<div>
        <p class="eyebrow">Com quem você quer ser atendido?</p>
        <div class="choice-grid">${state.barbers.map(b => `
          <button type="button" class="choice-card" data-barber="${b.id}">
            <strong>${esc(b.name)}</strong>
            <small>${esc(b.specialty)}</small>
            <div class="meta"><span>${hhmm(b.work_start)} às ${hhmm(b.work_end)}</span></div>
          </button>`).join('')}</div>
      </div>
      <div class="wizard-actions">
        <button type="button" class="link-button" id="back-1">← Trocar serviço (${esc(service ? service.name : '')})</button>
      </div>`;
    on('[data-barber]', 'click', e => {
      booking.barberId = e.currentTarget.dataset.barber;
      booking.time = null;
      renderWizard();
    }, body);
    bind('back-1', 'click', () => { booking.serviceId = null; renderWizard(); });
  }

  async function stepDateTime(body) {
    const service = state.services.find(s => s.id === booking.serviceId);
    const barber = state.barbers.find(b => b.id === booking.barberId);
    body.innerHTML = `
      <div class="form-row">
        <label>Data<input id="booking-date" type="date" min="${today()}" value="${booking.date}"></label>
        <div class="field-label">Profissional<div style="padding:13px 0;font-size:13px;font-weight:600;text-transform:none;letter-spacing:normal">${esc(barber ? barber.name : '')}${barber && barber.lunch_start ? ` · almoço ${hhmm(barber.lunch_start)}–${hhmm(barber.lunch_end)}` : ''}</div></div>
      </div>
      <div>
        <span class="field-label">Horários disponíveis para ${esc(service ? service.name : '')} (${duration(service ? service.duration_minutes : 30)})</span>
        <div id="availability" class="time-grid" style="margin-top:10px">Carregando…</div>
      </div>
      <div class="wizard-actions">
        <button type="button" class="link-button" id="back-2">← Trocar profissional</button>
      </div>`;

    bind('back-2', 'click', () => { booking.barberId = null; renderWizard(); });
    bind('booking-date', 'change', e => { booking.date = e.target.value; loadSlots(); });
    await loadSlots();

    async function loadSlots() {
      const grid = document.getElementById('availability');
      if (!grid) return;
      grid.innerHTML = 'Carregando…';
      const { data, error } = await api.rpc('get_availability', {
        p_barber_id: booking.barberId, p_date: booking.date, p_service_id: booking.serviceId
      });
      if (error) { grid.innerHTML = `<p class="off-banner">${esc(error.message)}</p>`; return; }

      const off = await api.from('barber_days_off').select('id')
        .eq('barber_id', booking.barberId).eq('off_date', booking.date).maybeSingle();
      if (off.data) { grid.innerHTML = `<p class="off-banner">Este profissional está de folga em ${br(booking.date)}.</p>`; return; }

      const slots = data || [];
      grid.innerHTML = slots.length
        ? slots.map(s => `<button type="button" data-time="${hhmm(s.slot_time)}">${hhmm(s.slot_time)}</button>`).join('')
        : `<p>Nenhum horário livre em ${br(booking.date)} para este serviço. Tente outra data.</p>`;
      on('[data-time]', 'click', e => {
        booking.time = e.currentTarget.dataset.time;
        renderWizard();
      }, grid);
    }
  }

  function stepConfirm(body) {
    const service = state.services.find(s => s.id === booking.serviceId);
    const barber = state.barbers.find(b => b.id === booking.barberId);
    const depositPct = state.settings.deposit_percent || 0;
    const paying = state.settings.payments_enabled;

    const logged = Boolean(state.customer);
    const deposit = Math.round((service.price_cents * depositPct) / 100);

    body.innerHTML = `
      <div class="summary-card">
        <div class="summary-row"><span>Serviço</span><strong>${esc(service.name)} · ${duration(service.duration_minutes)}</strong></div>
        <div class="summary-row"><span>Profissional</span><strong>${esc(barber.name)}</strong></div>
        <div class="summary-row"><span>Quando</span><strong>${weekday(booking.date)}, ${br(booking.date)} às ${booking.time}</strong></div>
        <div class="summary-row total"><span>Valor do serviço</span><strong id="total-value">${brl(service.price_cents)}</strong></div>
      </div>
      ${depositPct > 0 ? `<p class="deposit-note">${paying
        ? `Para garantir o horário é cobrado um sinal de <b>${depositPct}%</b> — <b id="deposit-value">${brl(deposit)}</b>. O restante fica para o dia do atendimento.`
        : `Sinal de <b>${depositPct}%</b> (<b id="deposit-value">${brl(deposit)}</b>) — hoje combinado direto na barbearia. O pagamento online entra em breve.`}</p>` : ''}

      ${logged ? `
        <form id="confirm-form" class="form-grid">
          <div class="form-row">
            <label>Cupom de desconto (opcional)<input name="coupon" placeholder="Ex.: NIVER2A9F1C" value="${esc(booking.coupon)}"></label>
            <label>Observação para o barbeiro<input name="notes" placeholder="Opcional" value="${esc(booking.notes)}"></label>
          </div>
          <button class="primary-button" type="submit">Confirmar agendamento <span>→</span></button>
          <p id="confirm-notice" class="notice"></p>
        </form>`
      : `<div class="summary-card" style="background:var(--gray-50);border-color:var(--gray-200)">
          <strong style="font-size:14px">Falta só entrar na sua conta.</strong>
          <p class="deposit-note">Seu cadastro guarda o histórico, libera cancelamento e remarcação pelo site e garante seu presente de aniversário.</p>
          <a class="primary-button" href="#entrar">Entrar ou criar conta <span>→</span></a>
        </div>`}

      <div class="wizard-actions">
        <button type="button" class="link-button" id="back-3">← Trocar horário</button>
        <button type="button" class="link-button" id="restart">Recomeçar</button>
      </div>`;

    bind('back-3', 'click', () => { booking.time = null; renderWizard(); });
    bind('restart', 'click', () => {
      booking.serviceId = null; booking.barberId = null; booking.time = null; booking.coupon = '';
      renderWizard();
    });

    bind('confirm-form', 'submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = new FormData(form);
      const button = form.querySelector('button[type=submit]');
      button.disabled = true;
      notice('confirm-notice', 'Confirmando…');

      const { error } = await api.rpc('create_appointment', {
        p_barber_id: booking.barberId,
        p_service_id: booking.serviceId,
        p_date: booking.date,
        p_time: booking.time,
        p_coupon_code: String(values.get('coupon') || '').trim() || null,
        p_notes: String(values.get('notes') || '').trim()
      });

      if (error) {
        notice('confirm-notice', error.message, 'error');
        button.disabled = false;
        return;
      }
      booking.serviceId = null; booking.barberId = null; booking.time = null; booking.coupon = '';
      location.hash = '#conta';
    });
  }

  /* =========================================================== planos ==== */

  async function renderPlans() {
    await loadReference();
    const phone = state.settings.shop_phone;

    app.innerHTML = shell(`
      <section class="section tight">
        <div class="section-heading">
          <div><p class="eyebrow">Conheça nossos planos</p><h2>Clube Di Tiglio</h2></div>
          <p>Assinatura mensal para quem não abre mão de estar sempre bem apresentado. Cancele quando quiser.</p>
        </div>
        <div class="plans-grid">${state.plans.map(p => `
          <article class="plan-card ${p.highlight ? 'featured' : ''}">
            ${p.highlight ? '<p class="eyebrow">Mais escolhido</p>' : ''}
            <h3>${esc(p.name)}</h3>
            <p>${esc(p.tagline)}</p>
            <div class="plan-price"><b>${brl(p.price_cents)}</b><span>/ ${esc(p.period)}</span></div>
            <ul class="plan-benefits">${(p.benefits || []).map(b => `<li>${esc(b)}</li>`).join('')}</ul>
            <button class="primary-button" data-plan="${p.id}">Quero este plano <span>→</span></button>
          </article>`).join('') || '<p class="empty-state">Nenhum plano publicado ainda.</p>'}
        </div>
        <p id="plan-notice" class="notice" style="margin-top:20px"></p>
      </section>`, 'planos');

    on('[data-plan]', 'click', async e => {
      const planId = e.currentTarget.dataset.plan;
      const plan = state.plans.find(p => p.id === planId);

      if (!state.customer) {
        notice('plan-notice', 'Entre na sua conta para assinar um plano.', 'error');
        location.hash = '#entrar';
        return;
      }

      const { error } = await api.from('subscriptions').insert({
        customer_id: state.customer.id, plan_id: planId, status: 'pending'
      });

      if (error) { notice('plan-notice', error.message, 'error'); return; }

      if (state.settings.payments_enabled) {
        notice('plan-notice', 'Assinatura registrada. Siga para o pagamento em Minha conta.', 'ok');
      } else {
        notice('plan-notice',
          `Pedido do plano ${plan.name} registrado. A barbearia vai confirmar com você${phone ? ' pelo WhatsApp' : ''}.`, 'ok');
      }
      if (phone) {
        window.open(waLink(phone, `Olá! Quero assinar o plano ${plan.name} da Di Tiglio.`), '_blank', 'noopener');
      }
    });
  }

  /* ===================================================== autenticação ==== */

  function authPage(mode, role) {
    const isBarber = role === 'barber';
    const register = mode === 'register';
    return `<main class="auth-page"><section class="auth-card">
      <div class="auth-brand">
        <a href="#inicio"><img src="ditiglio-logo-branca.png" alt="Di Tiglio"></a>
        <p>${isBarber ? 'Acesso exclusivo da equipe.' : 'Sua agenda, seu histórico e seu presente de aniversário em um só lugar.'}</p>
      </div>
      <div class="auth-content">
        <p class="eyebrow">${isBarber ? 'Acesso do barbeiro' : 'Área do cliente'}</p>
        <h1>${register ? 'Crie seu cadastro.' : 'Bem-vindo de volta.'}</h1>
        <div class="auth-tabs">
          <button data-mode="login" class="${register ? '' : 'active'}">Entrar</button>
          <button data-mode="register" class="${register ? 'active' : ''}">Cadastrar</button>
        </div>
        <form id="auth-form" class="form-grid">
          ${register ? (isBarber ? barberFields() : customerFields()) : ''}
          <label>E-mail<input name="email" type="email" required autocomplete="email"></label>
          <label>Senha<input name="password" type="password" required minlength="8" autocomplete="${register ? 'new-password' : 'current-password'}"></label>
          <button class="primary-button">${register ? 'Criar cadastro' : 'Entrar'} <span>→</span></button>
          <p id="auth-notice" class="notice"></p>
        </form>
        ${!register ? '<button class="link-button" id="forgot" style="margin-top:6px">Esqueci minha senha</button>' : ''}
        <a class="back-link" href="#inicio">← Voltar ao site</a>
      </div>
    </section></main>`;
  }

  const customerFields = () => `
    <label>Nome completo<input name="full_name" required minlength="3" autocomplete="name"></label>
    <div class="form-row">
      <label>Telefone / WhatsApp<input name="phone" required minlength="8" placeholder="(00) 00000-0000" autocomplete="tel"></label>
      <label>Data de nascimento<input name="birth_date" type="date" required max="${today()}"></label>
    </div>
    <label class="checkbox-row"><input type="checkbox" name="whatsapp_opt_in" checked> Quero receber confirmações e o presente de aniversário no WhatsApp</label>`;

  const barberFields = () => `
    <label>Nome completo<input name="name" required minlength="2"></label>
    <label>Especialidade<input name="specialty" required placeholder="Ex.: Degradê e barba"></label>
    <div class="form-row">
      <label>Início do expediente<input name="work_start" type="time" value="09:00" required></label>
      <label>Fim do expediente<input name="work_end" type="time" value="19:00" required></label>
    </div>
    <div class="form-row">
      <label>Almoço — início<input name="lunch_start" type="time" value="12:00"></label>
      <label>Almoço — fim<input name="lunch_end" type="time" value="13:00"></label>
    </div>`;

  function renderAuth(mode = 'login', role = 'customer') {
    app.innerHTML = authPage(mode, role);
    on('[data-mode]', 'click', e => renderAuth(e.currentTarget.dataset.mode, role));

    bind('forgot', 'click', async () => {
      const email = document.querySelector('input[name=email]').value.trim();
      if (!email) { notice('auth-notice', 'Digite seu e-mail acima e clique de novo.', 'error'); return; }
      const { error } = await api.auth.resetPasswordForEmail(email, {
        redirectTo: `${location.origin}${location.pathname}`
      });
      notice('auth-notice', error ? error.message : 'Enviamos um link de redefinição para seu e-mail.', error ? 'error' : 'ok');
    });

    bind('auth-form', 'submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const v = new FormData(form);
      const button = form.querySelector('button.primary-button');
      button.disabled = true;

      if (mode === 'login') {
        const { error } = await api.auth.signInWithPassword({
          email: v.get('email'), password: v.get('password')
        });
        if (error) { notice('auth-notice', 'E-mail ou senha inválidos.', 'error'); button.disabled = false; }
        return;
      }

      const meta = role === 'barber'
        ? {
            role: 'barber', name: v.get('name'), specialty: v.get('specialty'),
            work_start: v.get('work_start'), work_end: v.get('work_end'),
            lunch_start: v.get('lunch_start') || null, lunch_end: v.get('lunch_end') || null
          }
        : {
            role: 'customer', full_name: v.get('full_name'), phone: v.get('phone'),
            birth_date: v.get('birth_date'), whatsapp_opt_in: v.get('whatsapp_opt_in') === 'on'
          };

      const { error } = await api.auth.signUp({
        email: v.get('email'), password: v.get('password'),
        options: { emailRedirectTo: `${location.origin}${location.pathname}`, data: meta }
      });
      notice('auth-notice',
        error ? error.message : 'Cadastro criado. Confirme o e-mail que acabamos de enviar e depois entre.',
        error ? 'error' : 'ok');
      button.disabled = false;
    });
  }

  /* ====================================================== minha conta ==== */

  async function renderAccount() {
    if (!state.session) { renderAuth('login', 'customer'); return; }
    if (!state.customer) {
      if (state.role === 'barber' || state.role === 'admin') { location.hash = '#barbeiro'; return; }
      app.innerHTML = shell(`<main class="center-page"><section class="message-card">
        <h1>Cadastro incompleto</h1>
        <p>Não encontramos seu perfil de cliente. Confirme seu e-mail e entre novamente.</p>
        <button class="link-button" id="logout-x">Sair</button></section></main>`, 'conta');
      bind('logout-x', 'click', () => api.auth.signOut());
      return;
    }

    await loadReference();
    app.innerHTML = shell(`<section class="section tight" id="account-root">Carregando sua área…</section>`, 'conta');
    await paintAccount();
  }

  async function paintAccount() {
    const root = document.getElementById('account-root');
    if (!root) return;
    const uid = state.customer.id;

    const [apRes, coRes, suRes] = await Promise.all([
      api.from('appointments').select('*, services(name,duration_minutes), barbers(name)')
        .eq('customer_id', uid).order('appointment_date', { ascending: false }).order('start_time'),
      api.from('coupons').select('*').eq('customer_id', uid).order('created_at', { ascending: false }),
      api.from('subscriptions').select('*, plans(name,price_cents,period)')
        .eq('customer_id', uid).order('created_at', { ascending: false })
    ]);

    const appts = apRes.data || [];
    const coupons = coRes.data || [];
    const subs = suRes.data || [];
    const now = `${today()}`;
    const upcoming = appts.filter(a => a.appointment_date >= now && a.status !== 'cancelled');
    const history = appts.filter(a => !upcoming.includes(a));
    const first = state.customer.full_name.split(' ')[0];

    root.innerHTML = `
      <div class="portal-title">
        <div><p class="eyebrow">Área do cliente</p><h1>Olá, ${esc(first)}.</h1></div>
        <button class="ghost-button" id="logout">Sair da conta</button>
      </div>
      <p id="account-notice" class="notice" style="margin-bottom:18px"></p>

      <div class="account-grid">
        <div style="display:grid;gap:18px">
          <section class="card">
            <h2>Próximos atendimentos</h2>
            ${upcoming.length ? upcoming.map(apptRow).join('') : '<p class="empty-state">Você não tem agendamentos futuros. <a href="#agendar" style="color:var(--blue);font-weight:700">Agendar agora</a></p>'}
          </section>

          <section class="card">
            <h2>Histórico</h2>
            ${history.length ? history.slice(0, 12).map(apptRow).join('') : '<p class="empty-state">Nada por aqui ainda.</p>'}
          </section>
        </div>

        <div style="display:grid;gap:18px">
          <section class="card">
            <h2>Meus cupons</h2>
            <div class="card-body">
              ${coupons.length ? coupons.map(c => `
                <div class="coupon-card ${c.used_at ? 'used' : ''}">
                  <b>${esc(c.code)}</b>
                  <small>${c.discount_percent}% de desconto · ${c.reason === 'birthday' ? 'presente de aniversário' : 'cupom'}</small>
                  <small>${c.used_at ? 'Já utilizado' : `Válido até ${br(c.valid_until)}`}</small>
                </div>`).join('')
              : '<p class="muted" style="font-size:12px">Nenhum cupom por enquanto. No seu aniversário você ganha um.</p>'}
            </div>
          </section>

          <section class="card">
            <h2>Meu plano</h2>
            <div class="card-body">
              ${subs.length ? subs.map(s => `
                <div class="summary-row"><span>${esc(s.plans ? s.plans.name : 'Plano')}</span>
                <strong>${s.status === 'active' ? 'Ativo' : s.status === 'pending' ? 'Aguardando confirmação' : esc(s.status)}</strong></div>`).join('')
              : '<p class="muted" style="font-size:12px">Você ainda não assina nenhum plano.</p>'}
              <a class="ghost-button" href="#planos">Ver planos</a>
            </div>
          </section>

          <section class="card">
            <h2>Meus dados</h2>
            <form class="card-body" id="profile-form">
              <label>Nome completo<input name="full_name" value="${esc(state.customer.full_name)}" required minlength="3"></label>
              <label>Telefone / WhatsApp<input name="phone" value="${esc(state.customer.phone)}" required minlength="8"></label>
              <label>Data de nascimento<input name="birth_date" type="date" value="${esc(state.customer.birth_date)}" required></label>
              <label class="checkbox-row"><input type="checkbox" name="whatsapp_opt_in" ${state.customer.whatsapp_opt_in ? 'checked' : ''}> Receber mensagens no WhatsApp</label>
              <button class="primary-button">Salvar dados <span>→</span></button>
            </form>
          </section>
        </div>
      </div>`;

    bind('logout', 'click', () => api.auth.signOut());

    bind('profile-form', 'submit', async event => {
      event.preventDefault();
      const v = new FormData(event.currentTarget);
      const { error } = await api.from('customers').update({
        full_name: v.get('full_name'), phone: v.get('phone'),
        birth_date: v.get('birth_date'), whatsapp_opt_in: v.get('whatsapp_opt_in') === 'on'
      }).eq('id', state.customer.id);
      if (error) { notice('account-notice', error.message, 'error'); return; }
      await loadIdentity();
      notice('account-notice', 'Dados atualizados.', 'ok');
    });

    on('[data-cancel]', 'click', async e => {
      const id = e.currentTarget.dataset.cancel;
      if (!window.confirm('Cancelar este agendamento?')) return;
      const { error } = await api.rpc('cancel_appointment', { p_id: id, p_reason: 'Cancelado pelo cliente' });
      if (error) { notice('account-notice', error.message, 'error'); return; }
      await paintAccount();
      notice('account-notice', 'Agendamento cancelado.', 'ok');
    }, root);

    on('[data-reschedule]', 'click', e => {
      const id = e.currentTarget.dataset.reschedule;
      openReschedule(appts.find(a => a.id === id), paintAccount, 'account-notice');
    }, root);

    function apptRow(a) {
      const canChange = a.appointment_date >= now && a.status !== 'cancelled' && a.status !== 'completed';
      return `<div class="appt-row">
        <time>${hhmm(a.start_time)}<small>${br(a.appointment_date)}</small></time>
        <div class="who">
          <strong>${esc(a.services ? a.services.name : 'Serviço')} · ${esc(a.barbers ? a.barbers.name : '')}</strong>
          <small>${brl(a.price_cents)}${a.discount_percent ? ` · ${a.discount_percent}% off` : ''} · <span class="badge ${a.status}">${statusLabel[a.status] || a.status}</span></small>
        </div>
        <div class="actions">${canChange
          ? `<button class="small-button" data-reschedule="${a.id}">Remarcar</button>
             <button class="small-button danger" data-cancel="${a.id}">Cancelar</button>`
          : ''}</div>
      </div>`;
    }
  }

  /* -------------------------------------------------- modal de remarcar -- */

  function openReschedule(appt, refresh, noticeId) {
    if (!appt) return;
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = `<div class="modal-card">
      <header><h2>Remarcar</h2><button id="modal-close">×</button></header>
      <div class="modal-body">
        <p class="muted" style="font-size:12px;margin:0">Atual: ${br(appt.appointment_date)} às ${hhmm(appt.start_time)}</p>
        <label>Nova data<input id="re-date" type="date" min="${today()}" value="${appt.appointment_date}"></label>
        <div><span class="field-label">Novo horário</span><div id="re-slots" class="time-grid" style="margin-top:10px">Carregando…</div></div>
        <button class="primary-button" id="re-confirm" disabled>Confirmar remarcação <span>→</span></button>
        <p id="re-notice" class="notice"></p>
      </div></div>`;
    document.body.appendChild(wrap);

    let chosen = null;
    const close = () => wrap.remove();
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
    bind('modal-close', 'click', close);
    bind('re-date', 'change', loadSlots);
    loadSlots();

    async function loadSlots() {
      const grid = document.getElementById('re-slots');
      const date = document.getElementById('re-date').value;
      chosen = null;
      document.getElementById('re-confirm').disabled = true;
      grid.innerHTML = 'Carregando…';
      const { data, error } = await api.rpc('get_availability', {
        p_barber_id: appt.barber_id, p_date: date,
        p_service_id: appt.service_id, p_exclude_appointment: appt.id
      });
      if (error) { grid.innerHTML = `<p class="off-banner">${esc(error.message)}</p>`; return; }
      const slots = data || [];
      grid.innerHTML = slots.length
        ? slots.map(s => `<button type="button" data-time="${hhmm(s.slot_time)}">${hhmm(s.slot_time)}</button>`).join('')
        : '<p>Nenhum horário livre nesta data.</p>';
      on('[data-time]', 'click', e => {
        grid.querySelectorAll('button').forEach(b => b.classList.remove('selected'));
        e.currentTarget.classList.add('selected');
        chosen = e.currentTarget.dataset.time;
        document.getElementById('re-confirm').disabled = false;
      }, grid);
    }

    bind('re-confirm', 'click', async () => {
      const date = document.getElementById('re-date').value;
      const button = document.getElementById('re-confirm');
      button.disabled = true;
      const { error } = await api.rpc('reschedule_appointment', {
        p_id: appt.id, p_date: date, p_time: chosen
      });
      if (error) { notice('re-notice', error.message, 'error'); button.disabled = false; return; }
      close();
      await refresh();
      notice(noticeId, 'Agendamento remarcado.', 'ok');
    });
  }

  /* =============================================== portal do barbeiro ==== */

  async function renderPortal() {
    if (!state.session) { renderAuth('login', 'barber'); return; }
    if (state.role === 'customer') { location.hash = '#conta'; return; }

    await loadReference(true);
    const admin = state.role === 'admin';

    app.innerHTML = `<main class="portal-page">
      <header class="portal-header">
        <a href="#inicio"><img src="ditiglio-logo-branca.png" alt="Di Tiglio">
          <span>${admin ? 'PAINEL ADMINISTRATIVO' : 'PORTAL DO BARBEIRO'}</span></a>
        <div><span>${esc(state.session.user.email)}</span><button id="logout">Sair</button></div>
      </header>
      <div id="portal-root" class="portal-content">Carregando…</div>
    </main>`;

    bind('logout', 'click', () => api.auth.signOut());
    if (admin) await renderAdmin(); else await renderBarber();
  }

  async function renderBarber(date = today()) {
    const root = document.getElementById('portal-root');
    if (!root) return;
    const uid = state.session.user.id;

    const [pRes, aRes, oRes] = await Promise.all([
      api.from('barbers').select('*').eq('id', uid).maybeSingle(),
      api.from('appointments').select('*, services(name,duration_minutes)')
        .eq('barber_id', uid).eq('appointment_date', date).order('start_time'),
      api.from('barber_days_off').select('id').eq('barber_id', uid).eq('off_date', date).maybeSingle()
    ]);

    const profile = pRes.data;
    if (!profile) {
      root.innerHTML = '<p class="notice error">Perfil não encontrado. Confirme seu e-mail e entre novamente.</p>';
      return;
    }
    const items = (aRes.data || []).filter(a => a.status !== 'cancelled');
    const dayOffId = oRes.data && oRes.data.id;

    root.innerHTML = `
      <div class="portal-title">
        <div><p class="eyebrow">Minha agenda</p><h1>Olá, ${esc(profile.name.split(' ')[0])}.</h1></div>
      </div>
      <section class="toolbar">
        <label>Dia<input id="portal-date" type="date" value="${date}"></label>
        <div class="stat"><strong>${items.length}</strong><span>clientes no dia</span></div>
        <div class="stat"><strong>${profile.lunch_start ? hhmm(profile.lunch_start) : '—'}</strong><span>almoço</span></div>
        <button id="day-off" class="${dayOffId ? 'work-button' : 'off-button'}">
          ${dayOffId ? 'Voltar a trabalhar neste dia' : 'Marcar folga neste dia'}</button>
      </section>
      <p id="portal-notice" class="notice" style="margin-bottom:18px"></p>

      <section class="portal-grid">
        <div class="card">
          <h2>Atendimentos · ${weekday(date)}</h2>
          ${dayOffId ? '<div style="padding:18px 22px"><p class="off-banner">Você está de folga neste dia. A agenda está fechada para novos clientes.</p></div>' : ''}
          ${items.length ? items.map(a => `
            <div class="appt-row">
              <time>${hhmm(a.start_time)}<small>até ${hhmm(a.end_time)}</small></time>
              <div class="who">
                <strong>${esc(a.customer_name)}</strong>
                <small>${esc(a.services ? a.services.name : '')} · ${brl(a.price_cents)} · <span class="badge ${a.status}">${statusLabel[a.status] || a.status}</span></small>
              </div>
              <div class="actions">
                <a class="small-button" href="${waLink(a.customer_phone, `Olá ${a.customer_name.split(' ')[0]}, aqui é da Di Tiglio sobre seu horário de ${br(a.appointment_date)} às ${hhmm(a.start_time)}.`)}" target="_blank" rel="noopener">WhatsApp</a>
                <button class="small-button" data-reschedule="${a.id}">Remarcar</button>
                <button class="small-button danger" data-cancel="${a.id}">Desmarcar</button>
              </div>
            </div>`).join('') : '<p class="empty-state">Agenda livre neste dia.</p>'}
        </div>

        <form class="card" id="barber-profile">
          <h2>Meu perfil</h2>
          <div class="card-body">
            <label>Nome<input name="name" value="${esc(profile.name)}" required minlength="2"></label>
            <label>Especialidade<input name="specialty" value="${esc(profile.specialty)}" required></label>
            <div class="form-row">
              <label>Início<input name="work_start" type="time" value="${hhmm(profile.work_start)}" required></label>
              <label>Fim<input name="work_end" type="time" value="${hhmm(profile.work_end)}" required></label>
            </div>
            <div class="form-row">
              <label>Almoço início<input name="lunch_start" type="time" value="${profile.lunch_start ? hhmm(profile.lunch_start) : ''}"></label>
              <label>Almoço fim<input name="lunch_end" type="time" value="${profile.lunch_end ? hhmm(profile.lunch_end) : ''}"></label>
            </div>
            <label class="checkbox-row"><input type="checkbox" name="active" ${profile.active ? 'checked' : ''}> Aceitar novos agendamentos</label>
            <button class="primary-button">Salvar perfil <span>→</span></button>
          </div>
        </form>
      </section>`;

    bind('portal-date', 'change', e => renderBarber(e.target.value));

    bind('day-off', 'click', async () => {
      const res = dayOffId
        ? await api.from('barber_days_off').delete().eq('id', dayOffId)
        : await api.from('barber_days_off').insert({ barber_id: uid, off_date: date });
      if (res.error) notice('portal-notice', res.error.message, 'error');
      else await renderBarber(date);
    });

    bind('barber-profile', 'submit', async event => {
      event.preventDefault();
      const v = new FormData(event.currentTarget);
      const { error } = await api.from('barbers').update({
        name: v.get('name'), specialty: v.get('specialty'),
        work_start: v.get('work_start'), work_end: v.get('work_end'),
        lunch_start: v.get('lunch_start') || null, lunch_end: v.get('lunch_end') || null,
        active: v.get('active') === 'on'
      }).eq('id', uid);
      if (error) { notice('portal-notice', error.message, 'error'); return; }
      await renderBarber(date);
      notice('portal-notice', 'Perfil atualizado.', 'ok');
    });

    on('[data-cancel]', 'click', async e => {
      const id = e.currentTarget.dataset.cancel;
      const reason = window.prompt('Motivo do cancelamento (o cliente será avisado):', 'Imprevisto do barbeiro');
      if (reason === null) return;
      const { error } = await api.rpc('cancel_appointment', { p_id: id, p_reason: reason });
      if (error) { notice('portal-notice', error.message, 'error'); return; }
      await renderBarber(date);
      notice('portal-notice', 'Atendimento desmarcado e cliente notificado.', 'ok');
    }, root);

    on('[data-reschedule]', 'click', e => {
      const id = e.currentTarget.dataset.reschedule;
      openReschedule(items.find(a => a.id === id), () => renderBarber(date), 'portal-notice');
    }, root);
  }

  /* ============================================== painel administrativo == */

  const adminTab = { current: 'agenda', date: today() };

  async function renderAdmin() {
    const root = document.getElementById('portal-root');
    if (!root) return;
    const tabs = [['agenda', 'Agenda'], ['equipe', 'Equipe'], ['servicos', 'Serviços'],
                  ['planos', 'Planos'], ['config', 'Configurações']];

    root.innerHTML = `
      <div class="portal-title"><div><p class="eyebrow">Visão administrativa</p><h1>Di Tiglio</h1></div></div>
      <div class="tab-bar">${tabs.map(([k, l]) =>
        `<button data-tab="${k}" class="${adminTab.current === k ? 'active' : ''}">${l}</button>`).join('')}</div>
      <p id="admin-notice" class="notice" style="margin-bottom:16px"></p>
      <div id="admin-body">Carregando…</div>`;

    on('[data-tab]', 'click', e => { adminTab.current = e.currentTarget.dataset.tab; renderAdmin(); }, root);

    const body = document.getElementById('admin-body');
    if (adminTab.current === 'agenda') return adminAgenda(body);
    if (adminTab.current === 'equipe') return adminTeam(body);
    if (adminTab.current === 'servicos') return adminServices(body);
    if (adminTab.current === 'planos') return adminPlans(body);
    return adminSettings(body);
  }

  async function adminAgenda(body) {
    const date = adminTab.date;
    const [bRes, aRes, oRes] = await Promise.all([
      api.from('barbers').select('*').order('name'),
      api.from('appointments').select('*, services(name)').eq('appointment_date', date).order('start_time'),
      api.from('barber_days_off').select('barber_id').eq('off_date', date)
    ]);
    const barbers = bRes.data || [];
    const appts = (aRes.data || []);
    const offIds = (oRes.data || []).map(o => o.barber_id);
    const active = appts.filter(a => a.status !== 'cancelled');

    body.innerHTML = `
      <section class="toolbar" style="grid-template-columns:1fr 1fr 1fr 1fr">
        <label>Data<input id="admin-date" type="date" value="${date}"></label>
        <div class="stat"><strong>${barbers.filter(b => b.active).length}</strong><span>barbeiros ativos</span></div>
        <div class="stat"><strong>${active.length}</strong><span>atendimentos</span></div>
        <div class="stat"><strong>${brl(active.reduce((t, a) => t + a.price_cents, 0))}</strong><span>previsto no dia</span></div>
      </section>
      <section class="schedule-board">${barbers.map(b => {
        const items = active.filter(a => a.barber_id === b.id);
        const off = offIds.includes(b.id);
        return `<article class="schedule-card ${off ? 'is-off' : ''}">
          <header>
            <div><h2>${esc(b.name)}</h2><p>${esc(b.specialty)} · ${hhmm(b.work_start)}–${hhmm(b.work_end)}${b.lunch_start ? ` · almoço ${hhmm(b.lunch_start)}–${hhmm(b.lunch_end)}` : ''}</p></div>
            <span>${off ? 'DE FOLGA' : `${items.length} AGENDADOS`}</span>
          </header>
          ${items.length ? items.map(a => `
            <div class="appt-row">
              <time>${hhmm(a.start_time)}<small>até ${hhmm(a.end_time)}</small></time>
              <div class="who"><strong>${esc(a.customer_name)}</strong>
                <small>${esc(a.services ? a.services.name : '')} · ${esc(a.customer_phone)} · <span class="badge ${a.status}">${statusLabel[a.status] || a.status}</span></small></div>
              <div class="actions">
                <a class="small-button" href="${waLink(a.customer_phone, `Olá ${a.customer_name.split(' ')[0]}, aqui é da Di Tiglio.`)}" target="_blank" rel="noopener">WhatsApp</a>
                <button class="small-button danger" data-cancel="${a.id}">Desmarcar</button>
              </div>
            </div>`).join('') : '<p class="empty-state">Nenhum atendimento neste dia.</p>'}
        </article>`;
      }).join('') || '<p class="empty-state">Nenhum barbeiro cadastrado.</p>'}</section>`;

    bind('admin-date', 'change', e => { adminTab.date = e.target.value; renderAdmin(); });
    on('[data-cancel]', 'click', async e => {
      if (!window.confirm('Desmarcar este atendimento?')) return;
      const { error } = await api.rpc('cancel_appointment', { p_id: e.currentTarget.dataset.cancel, p_reason: 'Cancelado pela barbearia' });
      if (error) notice('admin-notice', error.message, 'error'); else renderAdmin();
    }, body);
  }

  async function adminTeam(body) {
    const { data } = await api.from('barbers').select('*').order('name');
    const barbers = data || [];
    body.innerHTML = `<section class="card"><h2>Equipe</h2><div class="admin-list">
      ${barbers.map(b => `<div class="row">
        <div><strong>${esc(b.name)}</strong><small>${esc(b.specialty)}</small></div>
        <div>${hhmm(b.work_start)}–${hhmm(b.work_end)}</div>
        <div>${b.lunch_start ? `${hhmm(b.lunch_start)}–${hhmm(b.lunch_end)}` : 'sem almoço'}</div>
        <button class="small-button ${b.active ? 'danger' : ''}" data-toggle="${b.id}" data-value="${b.active ? 'false' : 'true'}">
          ${b.active ? 'Desativar' : 'Reativar'}</button>
      </div>`).join('') || '<p class="empty-state">Nenhum barbeiro.</p>'}
      </div></section>
      <p class="muted" style="font-size:11px;margin-top:14px">Barbeiros se cadastram pelo botão “Sou barbeiro” na página inicial.</p>`;

    on('[data-toggle]', 'click', async e => {
      const { error } = await api.from('barbers')
        .update({ active: e.currentTarget.dataset.value === 'true' })
        .eq('id', e.currentTarget.dataset.toggle);
      if (error) notice('admin-notice', error.message, 'error'); else renderAdmin();
    }, body);
  }

  async function adminServices(body) {
    const { data } = await api.from('services').select('*').order('sort_order');
    const items = data || [];
    body.innerHTML = `
      <section class="card"><h2>Serviços</h2><div class="admin-list">
        ${items.map(s => `<div class="row">
          <div><strong>${esc(s.name)}</strong><small>${esc(s.description)}</small></div>
          <div>${duration(s.duration_minutes)}</div>
          <div>${brl(s.price_cents)}</div>
          <button class="small-button danger" data-del-service="${s.id}">Remover</button>
        </div>`).join('') || '<p class="empty-state">Nenhum serviço.</p>'}
      </div></section>
      <section class="card" style="margin-top:18px"><h2>Novo serviço</h2>
        <form class="card-body" id="service-form">
          <label>Nome<input name="name" required></label>
          <label>Descrição<input name="description"></label>
          <div class="form-row">
            <label>Duração (min)<select name="duration_minutes">${[15, 30, 45, 60, 75, 90, 120].map(m => `<option value="${m}" ${m === 60 ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
            <label>Preço (R$)<input name="price" type="number" min="0" step="0.01" value="60.00"></label>
          </div>
          <button class="primary-button">Adicionar serviço <span>→</span></button>
        </form></section>`;

    bind('service-form', 'submit', async event => {
      event.preventDefault();
      const v = new FormData(event.currentTarget);
      const { error } = await api.from('services').insert({
        name: v.get('name'), description: v.get('description') || '',
        duration_minutes: Number(v.get('duration_minutes')),
        price_cents: Math.round(Number(v.get('price')) * 100),
        sort_order: items.length + 1
      });
      if (error) notice('admin-notice', error.message, 'error'); else renderAdmin();
    });

    on('[data-del-service]', 'click', async e => {
      if (!window.confirm('Remover este serviço? Agendamentos antigos são mantidos.')) return;
      const { error } = await api.from('services').update({ active: false }).eq('id', e.currentTarget.dataset.delService);
      if (error) notice('admin-notice', error.message, 'error'); else renderAdmin();
    }, body);
  }

  async function adminPlans(body) {
    const { data } = await api.from('plans').select('*').order('sort_order');
    const items = data || [];
    body.innerHTML = `
      <section class="card"><h2>Planos</h2><div class="admin-list">
        ${items.map(p => `<div class="row">
          <div><strong>${esc(p.name)}</strong><small>${esc((p.benefits || []).join(' · '))}</small></div>
          <div>${brl(p.price_cents)}</div>
          <div>${p.active ? 'Publicado' : 'Oculto'}</div>
          <button class="small-button" data-toggle-plan="${p.id}" data-value="${p.active ? 'false' : 'true'}">${p.active ? 'Ocultar' : 'Publicar'}</button>
        </div>`).join('') || '<p class="empty-state">Nenhum plano.</p>'}
      </div></section>
      <section class="card" style="margin-top:18px"><h2>Novo plano</h2>
        <form class="card-body" id="plan-form">
          <label>Nome<input name="name" required></label>
          <label>Chamada<input name="tagline" placeholder="Uma frase curta"></label>
          <label>Preço mensal (R$)<input name="price" type="number" min="0" step="0.01" value="149.00"></label>
          <label>Benefícios (um por linha)<textarea name="benefits" placeholder="2 cortes por mês&#10;10% em produtos"></textarea></label>
          <label class="checkbox-row"><input type="checkbox" name="highlight"> Destacar como “mais escolhido”</label>
          <button class="primary-button">Adicionar plano <span>→</span></button>
        </form></section>`;

    bind('plan-form', 'submit', async event => {
      event.preventDefault();
      const v = new FormData(event.currentTarget);
      const { error } = await api.from('plans').insert({
        name: v.get('name'), tagline: v.get('tagline') || '',
        price_cents: Math.round(Number(v.get('price')) * 100),
        benefits: String(v.get('benefits') || '').split('\n').map(s => s.trim()).filter(Boolean),
        highlight: v.get('highlight') === 'on', sort_order: items.length + 1
      });
      if (error) notice('admin-notice', error.message, 'error'); else renderAdmin();
    });

    on('[data-toggle-plan]', 'click', async e => {
      const { error } = await api.from('plans')
        .update({ active: e.currentTarget.dataset.value === 'true' })
        .eq('id', e.currentTarget.dataset.togglePlan);
      if (error) notice('admin-notice', error.message, 'error'); else renderAdmin();
    }, body);
  }

  async function adminSettings(body) {
    const { data } = await api.from('settings').select('*').eq('id', 1).maybeSingle();
    const s = data || {};
    body.innerHTML = `<section class="card"><h2>Configurações</h2>
      <form class="card-body" id="settings-form">
        <div class="form-row">
          <label>Sinal cobrado (%)<input name="deposit_percent" type="number" min="0" max="100" value="${s.deposit_percent ?? 40}"></label>
          <label>Desconto de aniversário (%)<input name="birthday_discount_percent" type="number" min="0" max="100" value="${s.birthday_discount_percent ?? 20}"></label>
        </div>
        <div class="form-row">
          <label>Validade do cupom (dias)<input name="birthday_coupon_days" type="number" min="1" max="365" value="${s.birthday_coupon_days ?? 30}"></label>
          <label>Intervalo entre horários (min)<select name="slot_step_minutes">${[10, 15, 20, 30].map(m => `<option value="${m}" ${m === (s.slot_step_minutes ?? 15) ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        </div>
        <div class="form-row">
          <label>Antecedência mínima (min)<input name="min_lead_minutes" type="number" min="0" max="1440" value="${s.min_lead_minutes ?? 30}"></label>
          <label>Cancelar até (horas antes)<input name="min_cancel_hours" type="number" min="0" max="72" value="${s.min_cancel_hours ?? 2}"></label>
        </div>
        <label>WhatsApp da barbearia<input name="shop_phone" value="${esc(s.shop_phone || '')}" placeholder="(00) 00000-0000"></label>
        <label>Endereço<input name="shop_address" value="${esc(s.shop_address || '')}"></label>
        <label class="checkbox-row"><input type="checkbox" name="payments_enabled" ${s.payments_enabled ? 'checked' : ''}> Cobrança online ativa (sinal de ${s.deposit_percent ?? 40}% e planos)</label>
        <label class="checkbox-row"><input type="checkbox" name="whatsapp_enabled" ${s.whatsapp_enabled ? 'checked' : ''}> Disparo automático de WhatsApp ativo</label>
        <button class="primary-button">Salvar configurações <span>→</span></button>
      </form></section>`;

    bind('settings-form', 'submit', async event => {
      event.preventDefault();
      const v = new FormData(event.currentTarget);
      const { error } = await api.from('settings').update({
        deposit_percent: Number(v.get('deposit_percent')),
        birthday_discount_percent: Number(v.get('birthday_discount_percent')),
        birthday_coupon_days: Number(v.get('birthday_coupon_days')),
        slot_step_minutes: Number(v.get('slot_step_minutes')),
        min_lead_minutes: Number(v.get('min_lead_minutes')),
        min_cancel_hours: Number(v.get('min_cancel_hours')),
        shop_phone: v.get('shop_phone') || '',
        shop_address: v.get('shop_address') || '',
        payments_enabled: v.get('payments_enabled') === 'on',
        whatsapp_enabled: v.get('whatsapp_enabled') === 'on',
        updated_at: new Date().toISOString()
      }).eq('id', 1);
      if (error) { notice('admin-notice', error.message, 'error'); return; }
      await loadReference(true);
      notice('admin-notice', 'Configurações salvas.', 'ok');
    });
  }

  /* ========================================================= roteador ==== */

  function route() {
    const h = location.hash.replace('#', '');
    if (h.startsWith('barbeiro')) return 'barbeiro';
    if (h.startsWith('planos')) return 'planos';
    if (h.startsWith('conta')) return 'conta';
    if (h.startsWith('entrar')) return 'entrar';
    return 'inicio';
  }

  async function render() {
    const r = route();
    if (r === 'barbeiro') return renderPortal();
    if (r === 'planos') return renderPlans();
    if (r === 'conta') return renderAccount();
    if (r === 'entrar') {
      if (state.customer) { location.hash = '#conta'; return; }
      return renderAuth('login', 'customer');
    }
    await renderHome();
    if (location.hash === '#agendar') {
      const el = document.getElementById('agendar');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }
  }

  addEventListener('hashchange', render);

  api.auth.getSession().then(async ({ data }) => {
    state.session = data.session;
    await loadIdentity();
    render();
  });

  api.auth.onAuthStateChange(async (event, next) => {
    state.session = next;
    await loadIdentity();
    if (event === 'SIGNED_OUT') { location.hash = '#inicio'; }
    render();
  });

  if ('serviceWorker' in navigator) {
    addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => undefined));
  }
})();
