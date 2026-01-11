(function () {
  'use strict';

  // Jellyfin dashboard pages typically expose these globals.
  // If any are missing, the page will show a helpful message.
  const has = (k) => typeof window[k] !== 'undefined';

  const el = (id) => document.getElementById(id);

  const state = {
    playlistId: null,
    playlists: [],
    playlistsLoading: false,
    items: [],              // [{ index, itemId, playlistItemId, name, type, premiere, year }]
    total: null,
    startIndex: 0,
    limit: 200,
    throttleMs: 30,
    autoLoadAll: true,
    sortedItems: null
  };
  let uiBound = false;

  function setStatus(msg) {
    const status = el('ppStatusLine');
    if (status) status.textContent = msg;
  }

  function setProgress(pct) {
    const bar = el('ppProgressBar');
    if (!bar) return;
    bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }

  function requireGlobals() {
    const missing = [];
    if (!has('ApiClient')) missing.push('ApiClient');
    if (!has('Dashboard')) missing.push('Dashboard');

    if (missing.length) {
      setStatus(`Erro: faltando globals do Jellyfin (${missing.join(', ')}). Abra esta página pelo Dashboard do Jellyfin.`);
      return false;
    }
    return true;
  }

  function parseMaybeJson(payload) {
    if (payload == null) return payload;
    if (typeof payload === 'string') {
      return JSON.parse(payload);
    }
    return payload;
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }

  function parsePlaylistItem(dto, pos) {
    // dto: BaseItemDto (from /Playlists/{id}/Items)
    return {
      index: pos,
      itemId: dto.Id,
      playlistItemId: dto.PlaylistItemId || dto.PlaylistItemID, // be defensive
      name: dto.Name || '(sem nome)',
      type: dto.Type || '',
      premiere: dto.PremiereDate || null,
      year: dto.ProductionYear || null
    };
  }

  async function jfGet(url) {
    return window.ApiClient.ajax({
      type: 'GET',
      url: window.ApiClient.getUrl(url),
      dataType: 'json',
      headers: {
        accept: 'application/json'
      }
    });
  }

  async function jfPost(url) {
    return window.ApiClient.ajax({
      type: 'POST',
      url: window.ApiClient.getUrl(url)
    });
  }

  function getSelectedPlaylistId() {
    const select = el('ppPlaylistSelect');
    const manual = el('ppPlaylistId');
    const manualValue = (manual?.value || '').trim();
    if (!select) return manualValue;
    const value = (select.value || '').trim();
    if (!value || value === '__manual__') {
      return manualValue;
    }
    return value;
  }

  function updatePlaylistSelectUi() {
    const select = el('ppPlaylistSelect');
    const manualWrap = el('ppPlaylistManualWrap');
    if (!select || !manualWrap) return;
    const noPlaylists = !state.playlists || state.playlists.length === 0;
    manualWrap.hidden = !(select.value === '__manual__' || (noPlaylists && !select.value));
  }

  function setPlaylistSelectLoading() {
    const select = el('ppPlaylistSelect');
    const manualWrap = el('ppPlaylistManualWrap');
    if (!select) return;
    select.disabled = true;
    select.innerHTML = '<option value="">Carregando playlists...</option>';
    if (manualWrap) manualWrap.hidden = true;
  }

  function setPlaylistSelectError(message) {
    const select = el('ppPlaylistSelect');
    const manualWrap = el('ppPlaylistManualWrap');
    if (!select) return;
    select.disabled = false;
    select.innerHTML = [
      `<option value="">${escapeHtml(message)}</option>`,
      '<option value="__manual__">Informar ID manualmente</option>'
    ].join('');
    select.value = '__manual__';
    if (manualWrap) manualWrap.hidden = false;
  }

  function renderPlaylistOptions(previousId) {
    const select = el('ppPlaylistSelect');
    const manual = el('ppPlaylistId');
    if (!select) return;

    const playlists = state.playlists || [];
    const options = [];
    if (playlists.length) {
      options.push('<option value="">Selecione uma playlist...</option>');
    } else {
      options.push('<option value="">Nenhuma playlist encontrada</option>');
    }

    playlists.forEach(p => {
      const label = p.name || p.id || '(sem nome)';
      const safeId = escapeHtml(p.id || '');
      options.push(`<option value="${safeId}" title="${safeId}">${escapeHtml(label)}</option>`);
    });

    options.push('<option value="__manual__">Informar ID manualmente</option>');
    select.innerHTML = options.join('');
    select.disabled = false;

    if (previousId) {
      const exists = playlists.some(p => p.id === previousId);
      if (exists) {
        select.value = previousId;
      } else {
        select.value = '__manual__';
        if (manual) manual.value = previousId;
      }
    } else if (!playlists.length) {
      select.value = '__manual__';
    } else if (playlists.length === 1 && playlists[0].id) {
      select.value = playlists[0].id;
    }

    updatePlaylistSelectUi();
    select.dispatchEvent(new Event('change'));
  }

  async function getCurrentUserId() {
    let userId = '';

    try {
      if (window.ApiClient?.getCurrentUserId) {
        userId = window.ApiClient.getCurrentUserId();
      }
    } catch (e) {
      console.warn('ApiClient.getCurrentUserId failed', e);
    }

    if (!userId && window.Dashboard?.getCurrentUserId) {
      try {
        userId = window.Dashboard.getCurrentUserId();
      } catch (e) {
        console.warn('Dashboard.getCurrentUserId failed', e);
      }
    }

    if (!userId && window.ApiClient?.getCurrentUser) {
      try {
        const me = await window.ApiClient.getCurrentUser();
        userId = me?.Id || '';
      } catch (e) {
        console.warn('ApiClient.getCurrentUser failed', e);
      }
    }

    if (!userId) {
      try {
        const meText = await jfGet('/Users/Me');
        const me = parseMaybeJson(meText);
        userId = me?.Id || me?.User?.Id || '';
      } catch (e) {
        console.warn('GET /Users/Me failed', e);
      }
    }

    return userId || null;
  }

  async function loadPlaylists() {
    if (state.playlistsLoading) return;
    if (!requireGlobals()) return;
    const previousId = getSelectedPlaylistId();

    state.playlistsLoading = true;
    setPlaylistSelectLoading();

    try {
      const userId = await getCurrentUserId();
      if (!userId) {
        setPlaylistSelectError('Falha ao obter usuário atual.');
        setStatus('Falha ao obter usuário atual.');
        return;
      }

      const query = {
        IncludeItemTypes: 'Playlist',
        Recursive: true,
        SortBy: 'SortName',
        SortOrder: 'Ascending',
        Limit: 2000
      };

      let res;
      if (window.ApiClient?.getItems) {
        res = await window.ApiClient.getItems(userId, query);
      } else {
        const url = `/Users/${encodeURIComponent(userId)}/Items?IncludeItemTypes=Playlist&Recursive=true&SortBy=SortName&SortOrder=Ascending&Limit=2000`;
        const resText = await jfGet(url);
        res = parseMaybeJson(resText);
      }
      res = parseMaybeJson(res);

      const items = Array.isArray(res?.Items) ? res.Items : [];

      state.playlists = items
        .filter(item => item?.Id)
        .map(item => ({ id: item.Id, name: item.Name || item.Id }))
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));

      renderPlaylistOptions(previousId);
      setStatus(`Playlists encontradas: ${state.playlists.length}`);
    } catch (e) {
      console.error(e);
      setPlaylistSelectError('Falha ao carregar playlists.');
      setStatus('Falha ao carregar playlists. Verifique permissões.');
    } finally {
      state.playlistsLoading = false;
    }
  }

  async function loadPage(reset) {
    if (!state.playlistId) return;

    if (reset) {
      state.items = [];
      state.total = null;
      state.startIndex = 0;
      state.sortedItems = null;
      const tbody = el('ppTbody');
      if (tbody) tbody.innerHTML = '';
      setProgress(0);
    }

    const fields = [
      'PremiereDate',
      'ProductionYear',
      'SortName'
    ].join(',');

    const url = `/Playlists/${encodeURIComponent(state.playlistId)}/Items?startIndex=${state.startIndex}&limit=${state.limit}&fields=${encodeURIComponent(fields)}`;
    setStatus(`Carregando itens... (startIndex=${state.startIndex}, limit=${state.limit})`);

    let resText;
    try {
      resText = await jfGet(url);
    } catch (e) {
      console.error(e);
      setStatus(`Falha ao carregar itens. Confira o Playlist ID e permissões. (${e?.status || ''})`);
      return;
    }

    let res;
    try {
      res = parseMaybeJson(resText);
    } catch (e) {
      console.error('Failed to parse response', resText);
      setStatus('Falha ao interpretar resposta do servidor.');
      return;
    }

    const items = (res.Items || []).map((dto, i) => parsePlaylistItem(dto, state.items.length + i));
    state.total = res.TotalRecordCount ?? state.total ?? null;
    state.items.push(...items);
    state.startIndex = state.items.length;

    renderRows();

    if (state.total) {
      const pct = Math.round((state.items.length / state.total) * 100);
      setProgress(pct);
      setStatus(`Carregado: ${state.items.length} / ${state.total}`);
    } else {
      setStatus(`Carregado: ${state.items.length}`);
    }

    if (state.autoLoadAll && state.total && state.items.length < state.total) {
      // Yield to UI
      await new Promise(r => setTimeout(r, 0));
      return loadPage(false);
    }
  }

  function renderRows() {
    const tbody = el('ppTbody');
    if (!tbody) {
      setStatus('Tabela não encontrada. Recarregue a página.');
      return;
    }
    const rows = [];

    const base = state.sortedItems || state.items;
    const list = base.slice();

    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const premiere = fmtDate(it.premiere);
      const year = it.year ?? '';
      rows.push(`
        <tr data-pos="${i}" data-playlistitemid="${it.playlistItemId || ''}">
          <td><input class="ppSel" type="checkbox" /></td>
          <td class="pp-muted">${i}</td>
          <td>
            <div class="pp-name">${escapeHtml(it.name)}</div>
            <div class="pp-muted">${escapeHtml(it.itemId || '')}</div>
          </td>
          <td class="pp-muted">${escapeHtml(it.type || '')}</td>
          <td class="pp-muted">${escapeHtml(premiere)}</td>
          <td class="pp-muted">${escapeHtml(String(year))}</td>
          <td>
            <div class="pp-actions-inline">
              <button class="ppUp" is="emby-button" type="button">↑</button>
              <button class="ppDown" is="emby-button" type="button">↓</button>
              <button class="ppMove" is="emby-button" type="button">Mover…</button>
            </div>
          </td>
        </tr>
      `);
    }

    tbody.innerHTML = rows.join('');
    wireRowActions();
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function getSelectedPositions() {
    const tbody = el('ppTbody');
    if (!tbody) return [];
    const trs = Array.from(tbody.querySelectorAll('tr'));
    const selected = [];
    trs.forEach((tr, pos) => {
      const cb = tr.querySelector('.ppSel');
      if (cb && cb.checked) selected.push(pos);
    });
    return selected;
  }

  async function moveAt(currentPos, newPos) {
    const list = state.items;
    if (currentPos === newPos) return;

    const it = list[currentPos];
    if (!it?.playlistItemId) {
      throw new Error('playlistItemId missing; server did not return PlaylistItemId. Check fields / Jellyfin version.');
    }

    const url = `/Playlists/${encodeURIComponent(state.playlistId)}/Items/${encodeURIComponent(it.playlistItemId)}/Move/${newPos}`;
    await jfPost(url);

    // Update local ordering (optimistic)
    const removed = list.splice(currentPos, 1)[0];
    list.splice(newPos, 0, removed);

    // Re-render quickly
    renderRows();
  }

  async function applyTargetOrder(target) {
    // Apply by moving each item into its target position.
    // Strategy: iterate desired order, and for each position i, find that item in current list and Move it to i.
    const list = state.items;
    const targetList = target.slice();
    const idToCurrentIndex = () => {
      const m = new Map();
      list.forEach((x, idx) => m.set(x.playlistItemId, idx));
      return m;
    };

    state.sortedItems = null;
    setStatus('Aplicando ordenação (pode demorar)…');
    setProgress(0);

    for (let i = 0; i < targetList.length; i++) {
      const currentMap = idToCurrentIndex();
      const desired = targetList[i];
      const curIdx = currentMap.get(desired.playlistItemId);

      if (curIdx === undefined) continue;
      if (curIdx !== i) {
        await moveAt(curIdx, i);
        await new Promise(r => setTimeout(r, state.throttleMs));
      }

      const pct = Math.round(((i + 1) / targetList.length) * 100);
      setProgress(pct);
    }

    renderRows();
    setStatus('Ordenação aplicada.');
  }

  function sortBy(selector) {
    const asc = el('ppSortAsc').checked;

    const clone = state.items.slice();
    clone.sort((a, b) => {
      const av = selector(a);
      const bv = selector(b);

      // nulls last
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;

      if (av < bv) return asc ? -1 : 1;
      if (av > bv) return asc ? 1 : -1;
      return 0;
    });

    state.sortedItems = clone;
    renderRows();
    setStatus('Prévia de ordenação pronta. Clique em "Aplicar ordenação" para efetivar.');
  }

  function ensureMovesAllowed() {
    if (!state.sortedItems) return true;
    setStatus('Prévia de ordenação ativa. Aplique ou recarregue antes de mover itens.');
    return false;
  }

  function wireRowActions() {
    const tbody = el('ppTbody');
    tbody.querySelectorAll('button.ppUp').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!ensureMovesAllowed()) return;
        const tr = btn.closest('tr');
        const pos = Number(tr.getAttribute('data-pos'));
        if (pos <= 0) return;
        try {
          await moveAt(pos, pos - 1);
        } catch (e) {
          console.error(e);
          setStatus(`Erro ao mover: ${e.message || e}`);
        }
      });
    });

    tbody.querySelectorAll('button.ppDown').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!ensureMovesAllowed()) return;
        const tr = btn.closest('tr');
        const pos = Number(tr.getAttribute('data-pos'));
        const list = state.items;
        if (pos >= list.length - 1) return;
        try {
          await moveAt(pos, pos + 1);
        } catch (e) {
          console.error(e);
          setStatus(`Erro ao mover: ${e.message || e}`);
        }
      });
    });

    tbody.querySelectorAll('button.ppMove').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!ensureMovesAllowed()) return;
        const tr = btn.closest('tr');
        const pos = Number(tr.getAttribute('data-pos'));
        const list = state.items;
        const max = list.length - 1;
        const raw = prompt(`Mover item para qual índice? (0..${max})`, String(pos));
        if (raw == null) return;
        const target = Number(raw);
        if (!Number.isFinite(target) || target < 0 || target > max) {
          setStatus('Índice inválido.');
          return;
        }
        try {
          await moveAt(pos, target);
        } catch (e) {
          console.error(e);
          setStatus(`Erro ao mover: ${e.message || e}`);
        }
      });
    });
  }

  async function moveSelectedTo(targetIndex) {
    const selected = getSelectedPositions();
    if (!selected.length) {
      setStatus('Nada selecionado.');
      return;
    }

    const list = state.sortedItems || state.items;

    // Extract selected items (preserve their relative order as currently displayed)
    const selectedItems = selected.map(p => list[p]);

    // Remove them from the list (from bottom up to keep indices stable)
    selected.slice().sort((a,b)=>b-a).forEach(p => list.splice(p, 1));

    // Clamp target index
    targetIndex = Math.max(0, Math.min(list.length, targetIndex));

    // Insert at target
    list.splice(targetIndex, 0, ...selectedItems);

    // Apply to server order
    await applyTargetOrder(list);
  }

  function bindButtons() {
    if (uiBound) return;
    uiBound = true;

    el('ppPlaylistSelect').addEventListener('change', () => {
      updatePlaylistSelectUi();
    });

    el('ppReloadPlaylists').addEventListener('click', () => {
      loadPlaylists();
    });

    el('ppLoad').addEventListener('click', () => {
      if (!requireGlobals()) return;

      state.playlistId = getSelectedPlaylistId();
      state.limit = Number(el('ppPageSize').value) || 200;
      state.throttleMs = Number(el('ppMoveThrottle').value) || 0;
      state.autoLoadAll = !!el('ppAutoLoadAll').checked;

      if (!state.playlistId) {
        setStatus('Selecione uma playlist.');
        return;
      }

      loadPage(true);
    });

    el('ppReloadAll').addEventListener('click', () => {
      if (!state.playlistId) return;
      loadPage(true);
    });

    el('ppLoadMore').addEventListener('click', () => loadPage(false));

    el('ppSortPremiere').addEventListener('click', () => sortBy(x => x.premiere ? new Date(x.premiere).getTime() : null));
    el('ppSortYear').addEventListener('click', () => sortBy(x => x.year ?? null));
    el('ppSortName').addEventListener('click', () => sortBy(x => (x.name || '').toLowerCase()));

    el('ppApplyOrder').addEventListener('click', async () => {
      if (!state.sortedItems) {
        setStatus('Nenhuma prévia de ordenação ativa. Use um botão de "Ordenar por" primeiro.');
        return;
      }
      try {
        await applyTargetOrder(state.sortedItems);
      } catch (e) {
        console.error(e);
        setStatus(`Erro ao aplicar ordenação: ${e.message || e}`);
      }
    });

    el('ppSelectAll').addEventListener('click', () => {
      el('ppTbody').querySelectorAll('.ppSel').forEach(cb => cb.checked = true);
    });
    el('ppSelectNone').addEventListener('click', () => {
      el('ppTbody').querySelectorAll('.ppSel').forEach(cb => cb.checked = false);
    });

    el('ppMoveTop').addEventListener('click', async () => {
      try { await moveSelectedTo(0); } catch (e) { console.error(e); setStatus(`Erro: ${e.message || e}`); }
    });

    el('ppMoveBottom').addEventListener('click', async () => {
      try {
        const list = state.sortedItems || state.items;
        await moveSelectedTo(list.length);
      } catch (e) { console.error(e); setStatus(`Erro: ${e.message || e}`); }
    });

    el('ppMoveIndex').addEventListener('click', async () => {
      const list = state.sortedItems || state.items;
      const raw = prompt(`Mover seleção para qual índice? (0..${list.length})`, '0');
      if (raw == null) return;
      const idx = Number(raw);
      if (!Number.isFinite(idx) || idx < 0 || idx > list.length) {
        setStatus('Índice inválido.');
        return;
      }
      try { await moveSelectedTo(idx); } catch (e) { console.error(e); setStatus(`Erro: ${e.message || e}`); }
    });
  }

  function onPageShow() {
    // This is invoked when navigating to the plugin page inside Dashboard.
    if (!requireGlobals()) return;
    bindButtons();
    setStatus('Pronto. Escolha uma playlist e clique em Carregar.');
    setProgress(0);
    loadPlaylists();

    // Load defaults from plugin config (optional)
    try {
      window.ApiClient.getPluginConfiguration('b9b9a50f-8b3a-4d2a-9c0e-7e2d0d7c2d73')
        .then(cfg => {
          if (!cfg) return;
          if (typeof cfg.DefaultPageSize === 'number') el('ppPageSize').value = cfg.DefaultPageSize;
          if (typeof cfg.MoveThrottleMs === 'number') el('ppMoveThrottle').value = cfg.MoveThrottleMs;
        });
    } catch (e) {
      // ignore
    }
  }

  function onViewShow(e) {
    const target = e && e.target;
    if (!target || target.id !== 'PlaylistsPlusPage') return;
    onPageShow();
  }

  document.addEventListener('viewshow', onViewShow);
  document.addEventListener('pageshow', onViewShow);
})();
