
// Simple study app for Panama naturalization exam
const VERSION = '1.0.0';

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

const shuffle = (arr) => arr.map(v => [Math.random(), v]).sort((a,b)=>a[0]-b[0]).map(v=>v[1]);

const Store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  },
  set(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
};

const Leitner = {
  // boxes: 1 (review often) .. 5 (learned)
  nextInterval(box) {
    switch (box) {
      case 1: return 1; // 1 day
      case 2: return 2;
      case 3: return 4;
      case 4: return 7;
      default: return 14;
    }
  }
};

const App = {
  state: {
    mode: 'flashcards', // 'flashcards' | 'quiz' | 'review'
    data: [],
    index: 0,
    reveal: false,
    quiz: { current: null, choices: [], score: 0, total: 0 },
    deck: {},
    dueOnly: false,
  },
  async init() {
    // Register service worker (works when served over HTTPS)
    if ('serviceWorker' in navigator) {
      try { await navigator.serviceWorker.register('./service-worker.js'); }
      catch (e) { console.debug('SW registration failed', e); }
    }
    const res = await fetch('./questions.json'); 
    const data = await res.json();
    this.state.data = data;
    // Load deck stats
    const deck = Store.get('deck', {});
    data.forEach((q, i) => {
      const key = q.q;
      if (!deck[key]) deck[key] = { box: 1, next: 0, seen: 0, correct: 0, wrong: 0 };
    });
    this.state.deck = deck;
    this.render();
  },
  nowDays() { return Math.floor(Date.now() / 86400000); },
  dueFilter(q) {
    if (!this.state.dueOnly) return true;
    const card = this.state.deck[q.q];
    return (card?.next ?? 0) <= this.nowDays();
  },
  currentCard() {
    const pool = this.state.data.filter(q => this.dueFilter(q));
    if (pool.length === 0) return null;
    return pool[this.state.index % pool.length];
  },
  nextCard() {
    this.state.index++;
    this.state.reveal = false;
    this.render();
  },
  mark(result) {
    const q = this.currentCard(); if (!q) return;
    const card = this.state.deck[q.q];
    card.seen++;
    if (result === 'good' || result === true) {
      card.correct++;
      card.box = Math.min(5, (card.box ?? 1) + 1);
    } else {
      card.wrong++;
      card.box = 1;
    }
    card.next = this.nowDays() + Leitner.nextInterval(card.box);
    Store.set('deck', this.state.deck);
    this.nextCard();
  },
  startQuiz() {
    const pool = shuffle(this.state.data.filter(q => this.dueFilter(q)));
    this.state.quiz.total = Math.min(10, pool.length);
    this.state.quiz.score = 0;
    this.state.quiz.rounds = pool.slice(0, this.state.quiz.total).map(q => ({
      q,
      choices: shuffle([q.a, ...shuffle(q.choices.filter(c => c !== q.a)).slice(0,3)]).slice(0,4)
    }));
    this.state.quiz.i = 0;
    this.state.quiz.current = this.state.quiz.rounds[0];
    this.state.mode = 'quiz';
    this.render();
  },
  answer(choice) {
    const cur = this.state.quiz.current;
    const correct = choice === cur.q.a;
    if (correct) this.state.quiz.score++;
    // Update deck
    const card = this.state.deck[cur.q.q];
    card.seen++;
    if (correct) { card.correct++; card.box = Math.min(5, (card.box ?? 1) + 1); }
    else { card.wrong++; card.box = 1; }
    card.next = this.nowDays() + Leitner.nextInterval(card.box);
    Store.set('deck', this.state.deck);
    // Visual feedback
    cur.chosen = choice;
    this.render();
    setTimeout(() => {
      this.state.quiz.i++;
      if (this.state.quiz.i >= this.state.quiz.total) {
        this.state.mode = 'review';
      } else {
        this.state.quiz.current = this.state.quiz.rounds[this.state.quiz.i];
      }
      this.render();
    }, 650);
  },
  exportData() {
    const blob = new Blob([JSON.stringify({ deck: this.state.deck, custom: this.state.data }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'panama-ciudadania-progreso.json';
    a.click();
    URL.revokeObjectURL(url);
  },
  async importData(file) {
    const text = await file.text();
    try {
      const parsed = JSON.parse(text);
      if (parsed.deck) { this.state.deck = parsed.deck; Store.set('deck', this.state.deck); }
      if (Array.isArray(parsed.custom)) { this.state.data = parsed.custom; await fetch('./questions.json').catch(()=>{}); }
      alert('Importación completada');
      this.render();
    } catch (e) {
      alert('Archivo inválido');
    }
  },
  addCustom() {
    const q = prompt('Escribe la pregunta:');
    if (!q) return;
    const a = prompt('Escribe la respuesta correcta:');
    if (!a) return;
    const choicesRaw = prompt('Otras opciones separadas por coma (opcional):') || '';
    const choices = choicesRaw.split(',').map(s => s.trim()).filter(Boolean);
    const item = { q, a, choices: [a, ...choices] };
    this.state.data.push(item);
    const key = q; this.state.deck[key] = { box: 1, next: 0, seen: 0, correct: 0, wrong: 0 };
    Store.set('deck', this.state.deck);
    alert('Pregunta agregada');
    this.render();
  },
  resetProgress() {
    if (!confirm('¿Borrar tu progreso guardado?')) return;
    Object.keys(this.state.deck).forEach(k => { this.state.deck[k] = { box: 1, next: 0, seen: 0, correct: 0, wrong: 0 }; });
    Store.set('deck', this.state.deck);
    alert('Progreso restablecido');
    this.render();
  },
  setMode(mode) { this.state.mode = mode; this.render(); },
  toggleDueOnly() { this.state.dueOnly = !this.state.dueOnly; this.render(); },
  render() {
    const container = $('.app'); container.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'header';
    header.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <h1>Estudio Naturalización Panamá</h1>
        <span class="badge">v${VERSION}</span>
      </div>
      <div class="nav">
        <button class="btn" data-mode="flashcards">Tarjetas</button>
        <button class="btn" data-mode="quiz">Quiz</button>
        <button class="btn" data-mode="review">Resumen</button>
      </div>
    `;
    container.appendChild(header);
    header.querySelectorAll('button[data-mode]').forEach(b => b.onclick = () => {
      const m = b.getAttribute('data-mode');
      if (m === 'quiz') this.startQuiz();
      else this.setMode(m);
    });

    const topControls = document.createElement('div');
    topControls.className = 'controls';
    topControls.innerHTML = `
      <button class="btn" id="btn-add">Agregar pregunta</button>
      <button class="btn" id="btn-export">Exportar progreso</button>
      <label class="btn ghost">
        Importar <input type="file" id="file" style="display:none">
      </label>
      <button class="btn ghost" id="btn-reset">Reiniciar progreso</button>
      <button class="btn ghost" id="btn-due">${this.state.dueOnly ? 'Ver todas' : 'Solo vencidas'}</button>
      <button class="btn primary" id="btn-install">Instalar en iPhone</button>
    `;
    container.appendChild(topControls);

    $('#btn-add').onclick = () => this.addCustom();
    $('#btn-export').onclick = () => this.exportData();
    $('#file').onchange = e => this.importData(e.target.files[0]);
    $('#btn-reset').onclick = () => this.resetProgress();
    $('#btn-due').onclick = () => this.toggleDueOnly();
    $('#btn-install').onclick = () => {
      alert('En iPhone: en Safari, toca el botón Compartir (cuadro con flecha) → "Agregar a pantalla de inicio".');
    };

    const grid = document.createElement('div');
    grid.className = 'grid';
    container.appendChild(grid);

    // LEFT: Main card/quiz
    const main = document.createElement('div');
    main.className = 'card card-big';
    grid.appendChild(main);

    if (this.state.mode === 'flashcards') {
      const card = this.currentCard();
      if (!card) {
        main.innerHTML = `<p>No hay tarjetas ${this.state.dueOnly ? 'vencidas' : ''}. Agrega más o cambia el filtro.</p>`;
      } else {
        main.innerHTML = `
          <div>
            <div style="font-size:1.1rem; margin-bottom:12px;"><strong>Pregunta</strong></div>
            <div style="font-size:1.25rem; margin-bottom:20px;">${card.q}</div>
            ${this.state.reveal ? `<div style="font-size:1rem; margin-bottom:20px;"><strong>Respuesta:</strong> ${card.a}</div>` : ''}
            <div class="controls" style="justify-content:center;">
              ${this.state.reveal ? `
                <button class="btn" id="btn-wrong">Difícil</button>
                <button class="btn primary" id="btn-good">Fácil</button>
              ` : `<button class="btn primary" id="btn-show">Mostrar respuesta</button>`}
            </div>
          </div>
        `;
        $('#btn-show') && ($('#btn-show').onclick = () => { this.state.reveal = true; this.render(); });
        $('#btn-good') && ($('#btn-good').onclick = () => this.mark('good'));
        $('#btn-wrong') && ($('#btn-wrong').onclick = () => this.mark('wrong'));
        // keyboard
        window.onkeydown = (e) => {
          if (e.key === ' ') { e.preventDefault(); this.state.reveal ? this.mark('good') : (this.state.reveal = true, this.render()); }
          if (e.key === 'ArrowRight') this.nextCard();
          if (e.key === 'ArrowLeft') this.state.index = Math.max(0, this.state.index - 1), this.render();
        };
      }
    } else if (this.state.mode === 'quiz') {
      const cur = this.state.quiz.current;
      if (!cur) {
        main.innerHTML = `<p>Sin preguntas. Agrega más.</p>`;
      } else {
        const choicesHTML = cur.choices.map(c => {
          const cls = cur.chosen ? (c === cur.q.a ? 'correct' : (c === cur.chosen ? 'wrong' : '')) : '';
          return `<div class="choice ${cls}" data-choice="${c}">${c}</div>`;
        }).join('');
        main.innerHTML = `
          <div style="width:100%;">
            <div class="progress"><span style="width:${(this.state.quiz.i/this.state.quiz.total)*100}%"></span></div>
            <div style="margin-top:16px; font-size:1rem;"><strong>${this.state.quiz.i+1}/${this.state.quiz.total}</strong></div>
            <div style="font-size:1.25rem; margin:16px 0 20px;">${cur.q.q}</div>
            <div class="grid" style="grid-template-columns:1fr;gap:10px;">${choicesHTML}</div>
          </div>
        `;
        $$('.choice').forEach(el => el.onclick = () => !cur.chosen && this.answer(el.getAttribute('data-choice')));
      }
    } else if (this.state.mode === 'review') {
      main.innerHTML = `
        <div>
          <div style="font-size:1.25rem; margin-bottom:8px;">Resultado</div>
          <div style="font-size:1.1rem;">Puntaje: <strong>${this.state.quiz.score}/${this.state.quiz.total}</strong></div>
          <div class="controls" style="margin-top:16px;">
            <button class="btn primary" id="btn-again">Repetir quiz</button>
            <button class="btn" id="btn-back">Volver a tarjetas</button>
          </div>
        </div>
      `;
      $('#btn-again').onclick = () => this.startQuiz();
      $('#btn-back').onclick = () => this.setMode('flashcards');
    }

    // RIGHT: Stats
    const side = document.createElement('div');
    side.className = 'card';
    const total = this.state.data.length;
    const due = this.state.data.filter(q => this.dueFilter(q)).length;
    const seen = Object.values(this.state.deck).reduce((s,c)=>s+(c.seen||0),0);
    const correct = Object.values(this.state.deck).reduce((s,c)=>s+(c.correct||0),0);
    const acc = seen ? Math.round((correct/seen)*100) : 0;
    const boxCounts = [1,2,3,4,5].map(b => Object.values(this.state.deck).filter(c => (c.box||1)===b).length);
    side.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div><strong>Progreso</strong></div>
        <div class="badge">${acc}% aciertos</div>
      </div>
      <ul>
        <li>Total preguntas: <strong>${total}</strong></li>
        <li>Vencidas hoy: <strong>${due}</strong></li>
        <li>Vistas: <strong>${seen}</strong></li>
      </ul>
      <div style="margin-top:8px;"><strong>Cajas Leitner</strong></div>
      <ul style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;list-style:none;padding:0;margin:8px 0 0;">
        ${boxCounts.map((n,i)=>`<li class="badge" style="text-align:center;">${i+1}: ${n}</li>`).join('')}
      </ul>
      <div class="footer">
        Consejo: usa <kbd>Espacio</kbd> para marcar fácil y <kbd>→</kbd> para siguiente.
      </div>
    `;
    grid.appendChild(side);
  }
};

window.addEventListener('DOMContentLoaded', () => App.init());
