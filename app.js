(() => {
  'use strict';

  // ---------------------------------------------------------------
  // State
  // ---------------------------------------------------------------
  let FULL_WORD_LIST = [];           // loaded from words.json
  const guesses = [];                // [{ word: 'crane', colors: ['black','green',...] }]
  const activeTiles = makeEmptyTiles();
  let validationActive = false;      // true after a failed submit, until the user fixes something
  let knownGreens = {};              // position (0-4) -> letter confirmed green by an earlier guess

  function makeEmptyTiles() {
    return Array.from({ length: 5 }, () => ({ letter: '', state: null, locked: false }));
  }

  function recomputeKnownGreens() {
    knownGreens = {};
    guesses.forEach((g) => {
      g.colors.forEach((c, i) => {
        if (c === 'green') knownGreens[i] = g.word[i];
      });
    });
  }

  // Given a position and the letter just placed there, decide whether it
  // should auto-lock to green because an earlier guess already confirmed
  // that letter belongs in that exact spot.
  function autoStateForPosition(idx, letter) {
    if (knownGreens[idx] && knownGreens[idx] === letter) {
      return { state: 'green', locked: true };
    }
    return { state: 'black', locked: false };
  }

  // Re-applies the known-greens lock to whatever is currently sitting in the
  // active row. Used after the guess history changes (undo / edit a logged
  // guess) so an in-progress guess stays in sync.
  function reapplyKnownGreensToActiveRow() {
    for (let i = 0; i < 5; i++) {
      const tile = activeTiles[i];
      if (!tile.letter) continue;
      if (knownGreens[i] && knownGreens[i] === tile.letter) {
        tile.state = 'green';
        tile.locked = true;
      } else if (tile.locked) {
        // This tile was locked green from a constraint that's since gone away.
        tile.state = 'black';
        tile.locked = false;
      }
    }
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
      if (tile.locked) div.classList.add('locked');

      if (validationActive && !tile.letter) div.classList.add('needs-letter');
      if (validationActive && tile.letter && !tile.state) div.classList.add('needs-color');

      div.textContent = tile.letter;
      div.tabIndex = 0;
      div.setAttribute('role', 'button');
      div.setAttribute(
        'aria-label',
        tile.locked
          ? `Letter ${tile.letter}, position ${idx + 1}, locked green from an earlier guess.`
          : tile.letter
          ? `Letter ${tile.letter}, position ${idx + 1}, color ${tile.state || 'unset'}. Click to change color.`
          : `Empty tile, position ${idx + 1}`
      );
      div.addEventListener('click', () => onTileClick(idx));
      div.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
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
    if (!tile.letter || tile.locked) return;
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
          activeTiles[i] = { letter: '', state: null, locked: false };
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
          const letter = e.key.toLowerCase();
          // Default to gray, unless an earlier guess already confirmed this
          // exact letter is green in this exact position — then lock it in.
          activeTiles[i] = { letter, ...autoStateForPosition(i, letter) };
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
            e.stopPropagation();
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
    recomputeKnownGreens();
    reapplyKnownGreensToActiveRow();
    renderActiveTiles();
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
      chip.tabIndex = 0;
      chip.setAttribute('role', 'button');
      chip.setAttribute('aria-label', `Use "${w}" as your next guess`);
      chip.addEventListener('click', () => loadWordIntoActiveRow(w));
      chip.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          loadWordIntoActiveRow(w);
        }
      });
      wordGridEl.appendChild(chip);
    });

    if (filtered.length > MAX_DISPLAYED) {
      truncateNoteEl.hidden = false;
      truncateNoteEl.textContent = `showing first ${MAX_DISPLAYED.toLocaleString()} of ${filtered.length.toLocaleString()} — narrow with another guess or the filter box`;
    } else {
      truncateNoteEl.hidden = true;
    }
  }

  function loadWordIntoActiveRow(word) {
    // Populate the entry row from a candidate word, defaulting to gray
    // (auto-locking to green where an earlier guess already confirmed that
    // letter belongs in that position) — the user still has to color in
    // any remaining yellows and submit themselves.
    word.split('').forEach((letter, i) => {
      activeTiles[i] = { letter, ...autoStateForPosition(i, letter) };
    });
    validationActive = false;
    renderActiveTiles();
    if (typeof activeTilesEl.scrollIntoView === 'function') {
      activeTilesEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    recomputeKnownGreens();
    resetActiveTiles();
    renderLog();
    renderResults();
    undoBtn.disabled = false;
  }

  function resetActiveTiles() {
    for (let i = 0; i < 5; i++) activeTiles[i] = { letter: '', state: null, locked: false };
    validationActive = false;
    renderActiveTiles();
  }

  function undoLastGuess() {
    guesses.pop();
    recomputeKnownGreens();
    reapplyKnownGreensToActiveRow();
    renderActiveTiles();
    renderLog();
    renderResults();
    undoBtn.disabled = guesses.length === 0;
  }

  function resetAll() {
    guesses.length = 0;
    recomputeKnownGreens();
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
