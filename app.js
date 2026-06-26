(() => {
  'use strict';

  // ---------------------------------------------------------------
  // State
  // ---------------------------------------------------------------
  let FULL_WORD_LIST = [];           // loaded from words.json
  const guesses = [];                // [{ word: 'crane', colors: ['black','green',...] }]
  const activeTiles = makeEmptyTiles();
  let validationActive = false;      // true after a failed submit, until the user fixes something

  function makeEmptyTiles() {
    return Array.from({ length: 5 }, () => ({ letter: '', state: null }));
  }

  // ---------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------
  const activeTilesEl = document.getElementById('active-tiles');
  const submitBtn = document.getElementById('submit-guess');
  const clearBtn = document.getElementById('clear-guess');
  const undoBtn = document.getElementById('undo-guess');
  const resetBtn = document.getElementById('reset-all');
  const logRowsEl = document.getElementById('log-rows');
  const logEmptyEl = document.getElementById('log-empty');
  const resultCountEl = document.getElementById('result-count');
  const wordGridEl = document.getElementById('word-grid');
  const truncateNoteEl = document.getElementById('truncate-note');
  const filterBoxEl = document.getElementById('filter-box');
  const entryHintEl = document.getElementById('entry-hint');

  const MAX_DISPLAYED = 400;

  // ---------------------------------------------------------------
  // Wordle scoring algorithm (handles duplicate letters correctly)
  // ---------------------------------------------------------------
  function evaluateGuess(guessWord, candidateWord) {
    const result = new Array(5).fill('black');
    const guessLetters = guessWord.split('');
    const candidateLetters = candidateWord.split('');
    const remaining = {};

    for (const l of candidateLetters) remaining[l] = (remaining[l] || 0) + 1;

    // Pass 1: greens
    for (let i = 0; i < 5; i++) {
      if (guessLetters[i] === candidateLetters[i]) {
        result[i] = 'green';
        remaining[guessLetters[i]]--;
      }
    }
    // Pass 2: yellows / blacks
    for (let i = 0; i < 5; i++) {
      if (result[i] === 'green') continue;
      const l = guessLetters[i];
      if (remaining[l] > 0) {
        result[i] = 'yellow';
        remaining[l]--;
      } else {
        result[i] = 'black';
      }
    }
    return result;
  }

  function candidateMatchesGuess(candidateWord, guess) {
    const pattern = evaluateGuess(guess.word, candidateWord);
    for (let i = 0; i < 5; i++) {
      if (pattern[i] !== guess.colors[i]) return false;
    }
    return true;
  }

  function computePossibleWords() {
    if (guesses.length === 0) return FULL_WORD_LIST;
    return FULL_WORD_LIST.filter((w) => guesses.every((g) => candidateMatchesGuess(w, g)));
  }

  // ---------------------------------------------------------------
  // Rendering: active entry tiles
  // ---------------------------------------------------------------
  function renderActiveTiles() {
    activeTilesEl.innerHTML = '';
    activeTiles.forEach((tile, idx) => {
      const div = document.createElement('div');
      div.className = 'tile';
      if (tile.letter) div.classList.add('has-letter');
      if (tile.state) div.classList.add(`state-${tile.state}`);

      if (validationActive && !tile.letter) div.classList.add('needs-letter');
      if (validationActive && tile.letter && !tile.state) div.classList.add('needs-color');

      div.textContent = tile.letter;
      div.tabIndex = 0;
      div.setAttribute('role', 'button');
      div.setAttribute(
        'aria-label',
        tile.letter
          ? `Letter ${tile.letter}, position ${idx + 1}, color ${tile.state || 'unset'}. Click to change color.`
          : `Empty tile, position ${idx + 1}`
      );
      div.addEventListener('click', () => onTileClick(idx));
      div.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onTileClick(idx);
        }
      });
      activeTilesEl.appendChild(div);
    });

    const allFilled = activeTiles.every((t) => t.letter);
    const allColored = activeTiles.every((t) => t.state);
    submitBtn.classList.toggle('btn-incomplete', !(allFilled && allColored));

    entryHintEl.classList.remove('error');
    if (validationActive && !allFilled) {
      entryHintEl.textContent = 'fill in every letter first (see highlighted tiles)';
      entryHintEl.classList.add('error');
    } else if (validationActive && !allColored) {
      entryHintEl.textContent = 'click the highlighted tile(s) to give them a color, then add the guess again';
      entryHintEl.classList.add('error');
    } else if (!allFilled) {
      entryHintEl.textContent = 'type a 5-letter word — letters default to gray, click to mark green or yellow';
    } else {
      entryHintEl.textContent = 'looks good — press "Add guess" or hit Enter';
    }
  }

  function onTileClick(idx) {
    const tile = activeTiles[idx];
    if (!tile.letter) return;
    tile.state = nextState(tile.state);
    validationActive = false;
    renderActiveTiles();
  }

  function nextState(state) {
    if (state === null) return 'green';
    if (state === 'green') return 'yellow';
    if (state === 'yellow') return 'black';
    return 'green';
  }

  // ---------------------------------------------------------------
  // Keyboard entry (works for physical + most mobile soft keyboards)
  // ---------------------------------------------------------------
  function handleKeydown(e) {
    // Don't hijack typing while the filter box is focused.
    if (document.activeElement === filterBoxEl) return;

    if (e.key === 'Backspace') {
      e.preventDefault();
      for (let i = 4; i >= 0; i--) {
        if (activeTiles[i].letter) {
          activeTiles[i] = { letter: '', state: null };
          validationActive = false;
          renderActiveTiles();
          break;
        }
      }
      return;
    }

    if (e.key === 'Enter') {
      submitGuess();
      return;
    }

    if (/^[a-zA-Z]$/.test(e.key)) {
      for (let i = 0; i < 5; i++) {
        if (!activeTiles[i].letter) {
          // Default to gray ("black") — most letters end up gray, so this
          // means the user only has to click to mark greens and yellows.
          activeTiles[i] = { letter: e.key.toLowerCase(), state: 'black' };
          validationActive = false;
          renderActiveTiles();
          break;
        }
      }
    }
  }

  // ---------------------------------------------------------------
  // Guess log / history
  // ---------------------------------------------------------------
  function renderLog() {
    logRowsEl.innerHTML = '';
    if (guesses.length === 0) {
      logEmptyEl.hidden = false;
      return;
    }
    logEmptyEl.hidden = true;

    guesses.forEach((g, rowIdx) => {
      const row = document.createElement('div');
      row.className = 'log-row';
      g.word.split('').forEach((letter, i) => {
        const t = document.createElement('div');
        t.className = `tile mini state-${g.colors[i]}`;
        t.textContent = letter;
        t.tabIndex = 0;
        t.setAttribute('role', 'button');
        t.setAttribute(
          'aria-label',
          `Logged guess ${rowIdx + 1}, letter ${letter}, position ${i + 1}, color ${g.colors[i]}. Click to change color.`
        );
        t.addEventListener('click', () => onLogTileClick(rowIdx, i));
        t.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onLogTileClick(rowIdx, i);
          }
        });
        row.appendChild(t);
      });
      logRowsEl.appendChild(row);
    });
  }

  function onLogTileClick(rowIdx, letterIdx) {
    const g = guesses[rowIdx];
    g.colors[letterIdx] = nextState(g.colors[letterIdx]);
    renderLog();
    renderResults();
  }

  // ---------------------------------------------------------------
  // Results panel
  // ---------------------------------------------------------------
  let cachedPossible = [];

  function renderResults() {
    cachedPossible = computePossibleWords();
    resultCountEl.textContent = cachedPossible.length.toLocaleString();
    renderWordGrid();
  }

  function renderWordGrid() {
    const query = filterBoxEl.value.trim().toLowerCase();
    const filtered = query
      ? cachedPossible.filter((w) => w.includes(query))
      : cachedPossible;

    wordGridEl.innerHTML = '';

    if (filtered.length === 0) {
      const note = document.createElement('p');
      note.className = 'no-results';
      note.textContent = 'No words match — try undoing a guess or adjusting colors.';
      wordGridEl.appendChild(note);
      truncateNoteEl.hidden = true;
      return;
    }

    const shown = filtered.slice(0, MAX_DISPLAYED);
    shown.forEach((w) => {
      const chip = document.createElement('div');
      chip.className = 'word-chip';
      chip.textContent = w;
      wordGridEl.appendChild(chip);
    });

    if (filtered.length > MAX_DISPLAYED) {
      truncateNoteEl.hidden = false;
      truncateNoteEl.textContent = `showing first ${MAX_DISPLAYED.toLocaleString()} of ${filtered.length.toLocaleString()} — narrow with another guess or the filter box`;
    } else {
      truncateNoteEl.hidden = true;
    }
  }

  // ---------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------
  function submitGuess() {
    const word = activeTiles.map((t) => t.letter).join('');
    const colors = activeTiles.map((t) => t.state);

    if (word.length !== 5 || colors.some((c) => !c)) {
      validationActive = true;
      renderActiveTiles();
      return;
    }

    validationActive = false;
    guesses.push({ word, colors });
    resetActiveTiles();
    renderLog();
    renderResults();
    undoBtn.disabled = false;
  }

  function resetActiveTiles() {
    for (let i = 0; i < 5; i++) activeTiles[i] = { letter: '', state: null };
    validationActive = false;
    renderActiveTiles();
  }

  function undoLastGuess() {
    guesses.pop();
    renderLog();
    renderResults();
    undoBtn.disabled = guesses.length === 0;
  }

  function resetAll() {
    guesses.length = 0;
    resetActiveTiles();
    renderLog();
    renderResults();
    undoBtn.disabled = true;
    filterBoxEl.value = '';
  }

  // ---------------------------------------------------------------
  // Wire up events
  // ---------------------------------------------------------------
  submitBtn.addEventListener('click', submitGuess);
  clearBtn.addEventListener('click', resetActiveTiles);
  undoBtn.addEventListener('click', undoLastGuess);
  resetBtn.addEventListener('click', () => {
    if (guesses.length === 0) return resetAll();
    if (confirm('Reset all guesses and start over?')) resetAll();
  });
  filterBoxEl.addEventListener('input', renderWordGrid);
  document.addEventListener('keydown', handleKeydown);

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------
  async function init() {
    renderActiveTiles();
    renderLog();
    try {
      const res = await fetch('words.json');
      FULL_WORD_LIST = await res.json();
    } catch (err) {
      console.error('Failed to load word list', err);
      FULL_WORD_LIST = [];
    }
    renderResults();
  }

  init();
})();
