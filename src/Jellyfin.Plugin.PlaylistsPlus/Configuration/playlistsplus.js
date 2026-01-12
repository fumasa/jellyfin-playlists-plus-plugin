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
    sortedItems: null,
    metaEdits: new Map(),
    pendingImport: null
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

  function setPreviewLines(lines) {
    const preview = el('ppPreview');
    if (!preview) return;
    if (!lines || !lines.length) {
      preview.hidden = true;
      preview.innerHTML = '';
      return;
    }
    preview.hidden = false;
    preview.innerHTML = lines.map(line => `<div class="pp-preview-line">${escapeHtml(line)}</div>`).join('');
  }

  function getOrderChangeCount() {
    if (!state.sortedItems) return 0;
    const current = new Map();
    state.items.forEach((item, idx) => {
      if (item?.playlistItemId) current.set(item.playlistItemId, idx);
    });
    let changes = 0;
    state.sortedItems.forEach((item, idx) => {
      const cur = current.get(item.playlistItemId);
      if (cur !== idx) changes += 1;
    });
    return changes;
  }

  function getMetaEditSummary() {
    const summary = {
      items: 0,
      tags: 0,
      taglines: 0,
      sortName: 0,
      premiereDate: 0,
      productionYear: 0
    };

    state.metaEdits.forEach(edit => {
      summary.items += 1;
      if (edit.hasTags) summary.tags += 1;
      if (edit.hasTaglines) summary.taglines += 1;
      if (edit.hasSortName) summary.sortName += 1;
      if (edit.hasPremiereDate) summary.premiereDate += 1;
      if (edit.hasProductionYear) summary.productionYear += 1;
    });

    return summary;
  }

  function updatePreview() {
    const lines = [];
    const orderChanges = getOrderChangeCount();
    if (orderChanges) {
      lines.push(`Ordenação pendente: ${orderChanges} itens mudam de posição.`);
    }

    const metaSummary = getMetaEditSummary();
    if (metaSummary.items) {
      const parts = [];
      if (metaSummary.sortName) parts.push(`Sort name: ${metaSummary.sortName}`);
      if (metaSummary.taglines) parts.push(`Tagline: ${metaSummary.taglines}`);
      if (metaSummary.tags) parts.push(`Tags: ${metaSummary.tags}`);
      if (metaSummary.premiereDate) parts.push(`Lançamento: ${metaSummary.premiereDate}`);
      if (metaSummary.productionYear) parts.push(`Ano: ${metaSummary.productionYear}`);
      lines.push(`Metadados pendentes: ${metaSummary.items} itens (${parts.join(', ')}).`);
    }

    if (state.pendingImport) {
      const { missingIds, extraEntryIds } = state.pendingImport;
      if (missingIds?.length) {
        lines.push(`Importação pendente: adicionar ${missingIds.length} itens.`);
      }
      if (extraEntryIds?.length) {
        lines.push(`Importação pendente: remover ${extraEntryIds.length} itens.`);
      }
    }

    setPreviewLines(lines);
    const saveBtn = el('ppSaveChanges');
    if (saveBtn) {
      saveBtn.disabled = !(orderChanges || metaSummary.items || (state.pendingImport && (state.pendingImport.missingIds?.length || state.pendingImport.extraEntryIds?.length)));
    }
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
      seriesName: dto.SeriesName || null,
      seasonNumber: dto.ParentIndexNumber ?? null,
      episodeNumber: dto.IndexNumber ?? null,
      episodeNumberEnd: dto.IndexNumberEnd ?? null,
      tags: Array.isArray(dto.Tags) ? dto.Tags : [],
      taglines: Array.isArray(dto.Taglines) ? dto.Taglines : [],
      sortName: dto.ForcedSortName || dto.SortName || null,
      premiere: dto.PremiereDate || null,
      year: dto.ProductionYear || null
    };
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function formatEpisodeCode(item) {
    const season = item.seasonNumber;
    const episode = item.episodeNumber;
    const episodeEnd = item.episodeNumberEnd;

    let code = '';
    if (season != null && episode != null) {
      code = `S${pad2(season)}E${pad2(episode)}`;
    } else if (episode != null) {
      code = `E${pad2(episode)}`;
    } else if (season != null) {
      code = `S${pad2(season)}`;
    }

    if (code && episodeEnd != null && episodeEnd !== episode) {
      code += `-E${pad2(episodeEnd)}`;
    }

    return code;
  }

  function getDisplayTitle(item) {
    if (item.type === 'Episode') {
      const parts = [];
      if (item.seriesName) parts.push(item.seriesName);
      const code = formatEpisodeCode(item);
      if (code) parts.push(code);
      if (item.name) parts.push(item.name);
      return parts.join(' — ') || '(sem nome)';
    }
    return item.name || '(sem nome)';
  }

  function formatTypeLabel(type) {
    switch (type) {
      case 'Episode':
        return 'Episódio';
      case 'Movie':
        return 'Filme';
      case 'Series':
        return 'Série';
      case 'Season':
        return 'Temporada';
      default:
        return type || '';
    }
  }

  function normalizeText(value) {
    return String(value || '').trim();
  }

  function normalizeTagList(list) {
    return (list || [])
      .map(v => String(v || '').trim())
      .filter(Boolean)
      .map(v => v.toLowerCase())
      .sort();
  }

  function isSameTagList(a, b) {
    const left = normalizeTagList(a);
    const right = normalizeTagList(b);
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
      if (left[i] !== right[i]) return false;
    }
    return true;
  }

  function normalizeDateInput(value) {
    const raw = normalizeText(value);
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
  }

  function toUpdateDate(value) {
    if (!value) return null;
    if (value.includes('T')) return value;
    return `${value}T00:00:00.000Z`;
  }

  function getItemByItemId(itemId) {
    return state.items.find(item => String(item.itemId) === String(itemId)) || null;
  }

  function getBaseMeta(item) {
    return {
      tags: Array.isArray(item.tags) ? item.tags : [],
      taglines: Array.isArray(item.taglines) ? item.taglines : [],
      sortName: item.sortName || '',
      premiere: item.premiere || null,
      year: item.year ?? null
    };
  }

  function getMetaPendingFlags(item) {
    const edit = state.metaEdits.get(String(item.itemId));
    return {
      tags: !!edit?.hasTags,
      taglines: !!edit?.hasTaglines,
      sortName: !!edit?.hasSortName,
      premiereDate: !!edit?.hasPremiereDate,
      productionYear: !!edit?.hasProductionYear
    };
  }

  function getEffectiveMeta(item) {
    const base = getBaseMeta(item);
    const edit = state.metaEdits.get(String(item.itemId));
    if (!edit) return base;

    return {
      tags: edit.hasTags ? (edit.tags || []) : base.tags,
      taglines: edit.hasTaglines ? (edit.taglines || []) : base.taglines,
      sortName: edit.hasSortName ? (edit.sortName || '') : base.sortName,
      premiere: edit.hasPremiereDate ? edit.premiereDate : base.premiere,
      year: edit.hasProductionYear ? edit.productionYear : base.year
    };
  }

  function applyMetaEdit(itemId, field, value) {
    const item = getItemByItemId(itemId);
    if (!item) return;

    const base = getBaseMeta(item);
    const edit = state.metaEdits.get(String(itemId)) || {
      hasTags: false,
      hasTaglines: false,
      hasSortName: false,
      hasPremiereDate: false,
      hasProductionYear: false
    };

    if (field === 'tags') {
      const tags = parseStringList(value);
      const changed = !isSameTagList(tags, base.tags);
      edit.hasTags = changed;
      edit.tags = tags;
    } else if (field === 'tagline') {
      const tagline = normalizeText(value);
      const changed = normalizeText(base.taglines?.[0] || '') !== tagline;
      edit.hasTaglines = changed;
      edit.taglines = tagline ? [tagline] : [];
    } else if (field === 'sortName') {
      const sortName = normalizeText(value);
      const changed = normalizeText(base.sortName || '') !== sortName;
      edit.hasSortName = changed;
      edit.sortName = sortName;
    } else if (field === 'premiereDate') {
      const date = normalizeDateInput(value);
      const changed = normalizeDateInput(fmtDate(base.premiere)) !== date;
      edit.hasPremiereDate = changed;
      edit.premiereDate = date ? toUpdateDate(date) : null;
    } else if (field === 'productionYear') {
      const year = value === '' || value == null ? null : Number(value);
      const normalized = Number.isFinite(year) ? year : null;
      const changed = (base.year ?? null) !== normalized;
      edit.hasProductionYear = changed;
      edit.productionYear = normalized;
    }

    if (!(edit.hasTags || edit.hasTaglines || edit.hasSortName || edit.hasPremiereDate || edit.hasProductionYear)) {
      state.metaEdits.delete(String(itemId));
    } else {
      state.metaEdits.set(String(itemId), edit);
    }

    renderRows();
    updatePreview();
  }

  function promptMetaEdit(itemId, field) {
    const item = getItemByItemId(itemId);
    if (!item) return;
    const meta = getEffectiveMeta(item);

    let label = 'Valor';
    let defaultValue = '';

    switch (field) {
      case 'sortName':
        label = 'Sort name (vazio remove)';
        defaultValue = meta.sortName || '';
        break;
      case 'tagline':
        label = 'Tagline (vazio remove)';
        defaultValue = meta.taglines?.[0] || '';
        break;
      case 'tags':
        label = 'Tags (separe por vírgula; vazio remove)';
        defaultValue = (meta.tags || []).join(', ');
        break;
      case 'premiereDate':
        label = 'Lançamento (YYYY-MM-DD; vazio remove)';
        defaultValue = meta.premiere ? fmtDate(meta.premiere) : '';
        break;
      case 'productionYear':
        label = 'Ano (YYYY; vazio remove)';
        defaultValue = meta.year ?? '';
        break;
      default:
        return;
    }

    const raw = prompt(label, String(defaultValue));
    if (raw == null) return;
    applyMetaEdit(itemId, field, raw);
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

  async function jfPostUrl(url) {
    return window.ApiClient.ajax({
      type: 'POST',
      url: url
    });
  }

  async function jfDeleteUrl(url) {
    return window.ApiClient.ajax({
      type: 'DELETE',
      url: url
    });
  }

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function parseStringList(value) {
    if (Array.isArray(value)) {
      return value.map(v => String(v).trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
      return value
        .split(/[;,]/g)
        .map(v => v.trim())
        .filter(Boolean);
    }
    return [];
  }

  function getSelectedPlaylistName() {
    const select = el('ppPlaylistSelect');
    if (!select) return '';
    const selected = select.options[select.selectedIndex];
    return selected ? selected.textContent.trim() : '';
  }

  function normalizeImportItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const itemId = String(raw.itemId || raw.ItemId || raw.id || raw.Id || '').trim();
    if (!itemId) return null;

    const tagsField = hasOwn(raw, 'tags') ? raw.tags : (hasOwn(raw, 'Tags') ? raw.Tags : undefined);
    const taglinesField = hasOwn(raw, 'taglines') ? raw.taglines : (hasOwn(raw, 'Taglines') ? raw.Taglines : undefined);
    const taglineField = hasOwn(raw, 'tagline') ? raw.tagline : (hasOwn(raw, 'Tagline') ? raw.Tagline : undefined);
    const sortNameField = hasOwn(raw, 'sortName') ? raw.sortName
      : (hasOwn(raw, 'SortName') ? raw.SortName
        : (hasOwn(raw, 'forcedSortName') ? raw.forcedSortName
          : (hasOwn(raw, 'ForcedSortName') ? raw.ForcedSortName : undefined)));
    const premiereField = hasOwn(raw, 'premiereDate') ? raw.premiereDate : (hasOwn(raw, 'PremiereDate') ? raw.PremiereDate : undefined);
    const yearField = hasOwn(raw, 'productionYear') ? raw.productionYear : (hasOwn(raw, 'ProductionYear') ? raw.ProductionYear : undefined);

    return {
      itemId,
      raw,
      tags: parseStringList(tagsField),
      hasTags: tagsField !== undefined,
      taglines: parseStringList(taglinesField || taglineField),
      hasTaglines: taglinesField !== undefined || taglineField !== undefined,
      sortName: typeof sortNameField === 'string' ? sortNameField : (sortNameField != null ? String(sortNameField) : null),
      hasSortName: sortNameField !== undefined,
      premiereDate: premiereField != null ? String(premiereField) : null,
      hasPremiereDate: premiereField !== undefined,
      productionYear: yearField != null && yearField !== '' ? Number(yearField) : null,
      hasProductionYear: yearField !== undefined
    };
  }

  function normalizeImportData(payload) {
    if (!payload) return [];
    const items = Array.isArray(payload)
      ? payload
      : Array.isArray(payload.items)
        ? payload.items
        : [];

    return items.map(normalizeImportItem).filter(Boolean);
  }

  async function ensureAllLoaded() {
    if (!state.playlistId) {
      setStatus('Selecione uma playlist.');
      return false;
    }

    if (state.total && state.items.length === state.total) {
      return true;
    }

    const previousAuto = state.autoLoadAll;
    state.autoLoadAll = true;
    if (state.sortedItems) {
      state.sortedItems = null;
    }
    await loadPage(state.items.length === 0);
    state.autoLoadAll = previousAuto;

    if (!state.total || state.items.length < state.total) {
      setStatus('Não foi possível carregar todos os itens.');
      return false;
    }

    return true;
  }

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function readJsonFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(JSON.parse(reader.result));
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = () => reject(reader.error || new Error('Falha ao ler arquivo.'));
      reader.readAsText(file);
    });
  }

  async function exportPlaylist() {
    const includeMeta = !!el('ppExportMeta')?.checked;
    const ok = await ensureAllLoaded();
    if (!ok) return;

    const playlistName = getSelectedPlaylistName();
    const payload = {
      version: 1,
      playlistId: state.playlistId,
      playlistName: playlistName || null,
      exportedAt: new Date().toISOString(),
      items: state.items.map(item => {
        const meta = getEffectiveMeta(item);
        const base = {
          itemId: item.itemId,
          name: item.name,
          type: item.type,
          seriesName: item.seriesName,
          seasonNumber: item.seasonNumber,
          episodeNumber: item.episodeNumber,
          episodeNumberEnd: item.episodeNumberEnd,
          premiereDate: meta.premiere,
          productionYear: meta.year
        };

        if (includeMeta) {
          base.sortName = meta.sortName || '';
          base.tags = meta.tags || [];
          base.tagline = meta.taglines?.[0] || '';
        }

        return base;
      })
    };

    const safeName = (playlistName || 'playlist').replace(/[^\w.-]+/g, '_');
    downloadJson(`playlistsplus_${safeName}.json`, payload);
    setStatus('Exportação concluída.');
  }

  function getImportOptions() {
    return {
      reorder: !!el('ppImportReorder')?.checked,
      addMissing: !!el('ppImportAddMissing')?.checked,
      removeExtra: !!el('ppImportRemoveExtra')?.checked,
      dryRun: !!el('ppImportDryRun')?.checked,
      applyMetadata: !!el('ppImportApplyMetadata')?.checked,
      metaTagline: !!el('ppMetaTagline')?.checked,
      metaTags: !!el('ppMetaTags')?.checked,
      metaSortName: !!el('ppMetaSortName')?.checked,
      metaPremiere: !!el('ppMetaPremiere')?.checked,
      metaYear: !!el('ppMetaYear')?.checked
    };
  }

  async function addItemsToPlaylist(ids) {
    const chunkSize = 100;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const url = window.ApiClient.getUrl(`Playlists/${encodeURIComponent(state.playlistId)}/Items`, {
        Ids: chunk.join(',')
      });
      await jfPostUrl(url);
    }
  }

  async function removeItemsFromPlaylist(entryIds) {
    const chunkSize = 100;
    for (let i = 0; i < entryIds.length; i += chunkSize) {
      const chunk = entryIds.slice(i, i + chunkSize);
      const url = window.ApiClient.getUrl(`Playlists/${encodeURIComponent(state.playlistId)}/Items`, {
        EntryIds: chunk.join(',')
      });
      await jfDeleteUrl(url);
    }
  }

  function buildTargetOrder(items, importIds, removeExtra) {
    const queues = new Map();
    const consumed = new Set();

    items.forEach(item => {
      const key = item.itemId;
      if (!queues.has(key)) queues.set(key, []);
      queues.get(key).push(item);
    });

    const target = [];
    importIds.forEach(id => {
      const queue = queues.get(id);
      if (queue && queue.length) {
        const picked = queue.shift();
        consumed.add(picked.playlistItemId);
        target.push(picked);
      }
    });

    if (!removeExtra) {
      items.forEach(item => {
        if (!consumed.has(item.playlistItemId)) {
          consumed.add(item.playlistItemId);
          target.push(item);
        }
      });
    }

    return target;
  }

  async function fetchItemForUpdate(itemId) {
    const userId = await getCurrentUserId();
    if (!userId) {
      throw new Error('Falha ao obter usuário atual.');
    }
    if (window.ApiClient?.getItem) {
      return window.ApiClient.getItem(userId, itemId);
    }
    const data = await jfGet(`/Users/${encodeURIComponent(userId)}/Items/${encodeURIComponent(itemId)}`);
    return parseMaybeJson(data);
  }

  function buildUpdatePayload(item, meta) {
    const payload = {
      Id: item.Id,
      Name: item.Name,
      OriginalTitle: item.OriginalTitle,
      ForcedSortName: item.ForcedSortName || item.SortName || '',
      CommunityRating: item.CommunityRating,
      CriticRating: item.CriticRating,
      IndexNumber: item.IndexNumber,
      AirsBeforeSeasonNumber: item.AirsBeforeSeasonNumber,
      AirsAfterSeasonNumber: item.AirsAfterSeasonNumber,
      AirsBeforeEpisodeNumber: item.AirsBeforeEpisodeNumber,
      ParentIndexNumber: item.ParentIndexNumber,
      DisplayOrder: item.DisplayOrder,
      Album: item.Album,
      AlbumArtists: item.AlbumArtists,
      ArtistItems: item.ArtistItems,
      Overview: item.Overview,
      Status: item.Status,
      AirDays: item.AirDays,
      AirTime: item.AirTime,
      Genres: item.Genres || [],
      Tags: item.Tags || [],
      Studios: item.Studios || [],
      PremiereDate: item.PremiereDate,
      DateCreated: item.DateCreated,
      EndDate: item.EndDate,
      ProductionYear: item.ProductionYear,
      Height: item.Height,
      AspectRatio: item.AspectRatio,
      Video3DFormat: item.Video3DFormat,
      OfficialRating: item.OfficialRating,
      CustomRating: item.CustomRating,
      People: item.People,
      LockData: item.LockData,
      LockedFields: item.LockedFields,
      ProviderIds: { ...(item.ProviderIds || {}) },
      PreferredMetadataLanguage: item.PreferredMetadataLanguage,
      PreferredMetadataCountryCode: item.PreferredMetadataCountryCode,
      RunTimeTicks: item.RunTimeTicks,
      Taglines: item.Taglines || []
    };

    if (meta.hasSortName) {
      payload.ForcedSortName = meta.sortName || '';
    }
    if (meta.hasTags) {
      payload.Tags = meta.tags || [];
    }
    if (meta.hasTaglines) {
      payload.Taglines = meta.taglines || [];
    }
    if (meta.hasPremiereDate) {
      payload.PremiereDate = meta.premiereDate || null;
    }
    if (meta.hasProductionYear) {
      payload.ProductionYear = meta.productionYear || null;
    }

    return payload;
  }

  function applyMetaToLocalItem(itemId, meta) {
    const item = getItemByItemId(itemId);
    if (!item) return;
    if (meta.hasSortName) item.sortName = meta.sortName || '';
    if (meta.hasTags) item.tags = meta.tags || [];
    if (meta.hasTaglines) item.taglines = meta.taglines || [];
    if (meta.hasPremiereDate) item.premiere = meta.premiereDate || null;
    if (meta.hasProductionYear) item.year = meta.productionYear ?? null;
  }

  async function applyMetadataUpdates(importItems, options) {
    const metaMap = new Map();
    importItems.forEach(item => {
      const meta = {
        itemId: item.itemId,
        hasSortName: options.metaSortName && item.hasSortName,
        sortName: item.sortName,
        hasTags: options.metaTags && item.hasTags,
        tags: item.tags,
        hasTaglines: options.metaTagline && item.hasTaglines,
        taglines: item.taglines,
        hasPremiereDate: options.metaPremiere && item.hasPremiereDate,
        premiereDate: item.premiereDate,
        hasProductionYear: options.metaYear && item.hasProductionYear,
        productionYear: item.productionYear
      };

      if (meta.hasSortName || meta.hasTags || meta.hasTaglines || meta.hasPremiereDate || meta.hasProductionYear) {
        metaMap.set(item.itemId, meta);
      }
    });

    const itemsToUpdate = state.items.filter(item => metaMap.has(item.itemId));
    if (!itemsToUpdate.length) {
      setStatus('Nenhum item com metadados para aplicar.');
      return;
    }

    setStatus(`Aplicando metadados em ${itemsToUpdate.length} itens...`);
    setProgress(0);

    for (let i = 0; i < itemsToUpdate.length; i++) {
      const entry = itemsToUpdate[i];
      const meta = metaMap.get(entry.itemId);

      try {
        const item = await fetchItemForUpdate(entry.itemId);
        const payload = buildUpdatePayload(item, meta);
        if (window.ApiClient?.updateItem) {
          await window.ApiClient.updateItem(payload);
        } else {
          await window.ApiClient.ajax({
            type: 'POST',
            url: window.ApiClient.getUrl(`Items/${encodeURIComponent(entry.itemId)}`),
            data: JSON.stringify(payload),
            contentType: 'application/json'
          });
        }
        applyMetaToLocalItem(entry.itemId, meta);
      } catch (e) {
        console.error(e);
        setStatus(`Erro ao atualizar metadados de ${entry.itemId}`);
      }

      const pct = Math.round(((i + 1) / itemsToUpdate.length) * 100);
      setProgress(pct);
      if (state.throttleMs) {
        await new Promise(r => setTimeout(r, state.throttleMs));
      }
    }

    setStatus('Metadados aplicados.');
    renderRows();
    updatePreview();
  }

  async function applyPendingMetadataEdits() {
    const entries = Array.from(state.metaEdits.entries());
    if (!entries.length) return;

    setStatus(`Aplicando metadados em ${entries.length} itens...`);
    setProgress(0);

    for (let i = 0; i < entries.length; i++) {
      const [itemId, meta] = entries[i];
      try {
        const item = await fetchItemForUpdate(itemId);
        const payload = buildUpdatePayload(item, meta);
        if (window.ApiClient?.updateItem) {
          await window.ApiClient.updateItem(payload);
        } else {
          await window.ApiClient.ajax({
            type: 'POST',
            url: window.ApiClient.getUrl(`Items/${encodeURIComponent(itemId)}`),
            data: JSON.stringify(payload),
            contentType: 'application/json'
          });
        }
        applyMetaToLocalItem(itemId, meta);
      } catch (e) {
        console.error(e);
        setStatus(`Erro ao atualizar metadados de ${itemId}`);
      }

      const pct = Math.round(((i + 1) / entries.length) * 100);
      setProgress(pct);
      if (state.throttleMs) {
        await new Promise(r => setTimeout(r, state.throttleMs));
      }
    }

    setStatus('Metadados aplicados.');
    renderRows();
    updatePreview();
  }

  function mergeImportMetaEdits(importItems, options) {
    importItems.forEach(item => {
      const edit = state.metaEdits.get(String(item.itemId)) || {
        hasTags: false,
        hasTaglines: false,
        hasSortName: false,
        hasPremiereDate: false,
        hasProductionYear: false
      };

      if (options.metaSortName && item.hasSortName) {
        edit.hasSortName = true;
        edit.sortName = item.sortName || '';
      }
      if (options.metaTags && item.hasTags) {
        edit.hasTags = true;
        edit.tags = item.tags || [];
      }
      if (options.metaTagline && item.hasTaglines) {
        edit.hasTaglines = true;
        edit.taglines = item.taglines || [];
      }
      if (options.metaPremiere && item.hasPremiereDate) {
        edit.hasPremiereDate = true;
        edit.premiereDate = item.premiereDate || null;
      }
      if (options.metaYear && item.hasProductionYear) {
        edit.hasProductionYear = true;
        edit.productionYear = item.productionYear ?? null;
      }

      if (edit.hasTags || edit.hasTaglines || edit.hasSortName || edit.hasPremiereDate || edit.hasProductionYear) {
        state.metaEdits.set(String(item.itemId), edit);
      }
    });
  }

  async function importPlaylist(payload) {
    const options = getImportOptions();
    const importItems = normalizeImportData(payload);
    if (!importItems.length) {
      setStatus('Arquivo de importação vazio ou inválido.');
      return;
    }

    const ok = await ensureAllLoaded();
    if (!ok) return;

    const importIds = importItems.map(item => item.itemId);
    const currentIds = new Set(state.items.map(item => item.itemId));

    if (options.dryRun) {
      const missingIds = options.addMissing ? importIds.filter(id => !currentIds.has(id)) : [];
      const importIdSet = new Set(importIds);
      const extraEntryIds = options.removeExtra
        ? state.items
            .filter(item => !importIdSet.has(item.itemId) && item.playlistItemId)
            .map(item => item.playlistItemId)
        : [];

      state.pendingImport = {
        missingIds,
        extraEntryIds,
        importIds,
        options
      };

      if (options.reorder) {
        state.sortedItems = buildTargetOrder(state.items, importIds, options.removeExtra);
      } else {
        state.sortedItems = null;
      }

      if (options.applyMetadata && (options.metaTags || options.metaTagline || options.metaSortName || options.metaPremiere || options.metaYear)) {
        mergeImportMetaEdits(importItems, options);
      }

      renderRows();
      setStatus('Simulação pronta. Revise e clique em "Salvar alterações" para aplicar.');
      return;
    }

    if (options.addMissing) {
      const missing = importIds.filter(id => !currentIds.has(id));
      if (missing.length) {
        setStatus(`Adicionando ${missing.length} itens faltantes...`);
        await addItemsToPlaylist(missing);
        await loadPage(true);
      }
    }

    if (options.removeExtra) {
      const importIdSet = new Set(importIds);
      const extraEntryIds = state.items
        .filter(item => !importIdSet.has(item.itemId) && item.playlistItemId)
        .map(item => item.playlistItemId);
      if (extraEntryIds.length) {
        setStatus(`Removendo ${extraEntryIds.length} itens extras...`);
        await removeItemsFromPlaylist(extraEntryIds);
        await loadPage(true);
      }
    }

    if (options.reorder) {
      const target = buildTargetOrder(state.items, importIds, options.removeExtra);
      await applyTargetOrder(target);
    }

    if (options.applyMetadata && (options.metaTags || options.metaTagline || options.metaSortName || options.metaPremiere || options.metaYear)) {
      await applyMetadataUpdates(importItems, options);
    }

    state.pendingImport = null;
    state.metaEdits.clear();
    updatePreview();
    setStatus('Importação concluída.');
  }

  async function reloadItemsPreserveEdits() {
    const savedEdits = new Map(state.metaEdits);
    const savedPending = state.pendingImport;
    await loadPage(true);
    state.metaEdits = savedEdits;
    state.pendingImport = savedPending;
    renderRows();
    updatePreview();
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
      state.metaEdits.clear();
      state.pendingImport = null;
      const tbody = el('ppTbody');
      if (tbody) tbody.innerHTML = '';
      setProgress(0);
      updatePreview();
    }

    const fields = [
      'PremiereDate',
      'ProductionYear',
      'SortName',
      'Taglines',
      'Tags'
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
    const currentIndex = new Map();
    state.items.forEach((item, idx) => {
      if (item?.playlistItemId) currentIndex.set(item.playlistItemId, idx);
    });
    const hasPreview = !!state.sortedItems;

    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const currentPos = currentIndex.get(it.playlistItemId) ?? i;
      const newPos = hasPreview ? i : currentPos;
      const posChanged = hasPreview && currentPos !== newPos;
      const title = getDisplayTitle(it);
      const typeLabel = formatTypeLabel(it.type);
      const titleAttr = it.itemId ? ` title="${escapeHtml(it.itemId)}"` : '';
      const meta = getEffectiveMeta(it);
      const pending = getMetaPendingFlags(it);
      const effectivePremiere = fmtDate(meta.premiere);
      const effectiveYear = meta.year ?? '';
      const premiereClass = pending.premiereDate ? ' pp-meta-pending' : '';
      const yearClass = pending.productionYear ? ' pp-meta-pending' : '';
      const posClass = posChanged ? ' pp-pos-change' : '';
      const metaLines = [
        renderMetaLine('sortName', 'Sort', meta.sortName || '', pending.sortName, it.itemId),
        renderMetaLine('tagline', 'Tagline', meta.taglines?.[0] || '', pending.taglines, it.itemId),
        renderMetaLine('tags', 'Tags', (meta.tags || []).join(', '), pending.tags, it.itemId)
      ].join('');
      rows.push(`
        <tr data-pos="${i}" data-playlistitemid="${it.playlistItemId || ''}" data-itemid="${escapeHtml(it.itemId || '')}">
          <td><input class="ppSel" type="checkbox" /></td>
          <td class="pp-muted">${currentPos}</td>
          <td class="pp-muted pp-pos-new${posClass}">${newPos}</td>
          <td>
            <div class="pp-name"${titleAttr}>${escapeHtml(title)}</div>
            <div class="pp-meta">${metaLines}</div>
          </td>
          <td class="pp-muted">${escapeHtml(typeLabel)}</td>
          <td class="pp-muted pp-editable${premiereClass}" data-field="premiereDate" data-itemid="${escapeHtml(it.itemId || '')}">${escapeHtml(effectivePremiere)}</td>
          <td class="pp-muted pp-editable${yearClass}" data-field="productionYear" data-itemid="${escapeHtml(it.itemId || '')}">${escapeHtml(String(effectiveYear))}</td>
          <td>
            <div class="pp-actions-inline">
              <button class="pp-action-btn ppUp" type="button">↑</button>
              <button class="pp-action-btn ppDown" type="button">↓</button>
              <button class="pp-action-btn pp-action-btn--move ppMove" type="button">Mover…</button>
            </div>
          </td>
        </tr>
      `);
    }

    tbody.innerHTML = rows.join('');
    wireRowActions();
    updatePreview();
  }

  function renderMetaLine(field, label, value, isPending, itemId) {
    const display = value ? escapeHtml(value) : '—';
    const pendingClass = isPending ? ' pp-meta-pending' : '';
    return `<div class="pp-meta-line${pendingClass}" data-field="${field}" data-itemid="${escapeHtml(itemId || '')}" title="Clique para editar">${escapeHtml(label)}: <span class="pp-meta-value">${display}</span></div>`;
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
    updatePreview();
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
    state.pendingImport = null;
    renderRows();
    setStatus('Prévia de ordenação pronta. Clique em "Salvar alterações" para efetivar.');
  }

  function ensureMovesAllowed() {
    if (!state.sortedItems) return true;
    setStatus('Prévia de ordenação ativa. Salve ou recarregue antes de mover itens.');
    return false;
  }

  async function saveChanges() {
    if (!state.playlistId) {
      setStatus('Selecione uma playlist.');
      return;
    }

    const hasOrder = !!state.sortedItems;
    const hasMeta = state.metaEdits.size > 0;
    const hasImport = !!state.pendingImport;

    if (!(hasOrder || hasMeta || hasImport)) {
      setStatus('Nenhuma alteração pendente.');
      return;
    }

    try {
      if (state.pendingImport) {
        const { missingIds, extraEntryIds, importIds, options } = state.pendingImport;
        if (missingIds?.length) {
          setStatus(`Adicionando ${missingIds.length} itens...`);
          await addItemsToPlaylist(missingIds);
        }
        if (extraEntryIds?.length) {
          setStatus(`Removendo ${extraEntryIds.length} itens...`);
          await removeItemsFromPlaylist(extraEntryIds);
        }
        if ((missingIds && missingIds.length) || (extraEntryIds && extraEntryIds.length)) {
          await reloadItemsPreserveEdits();
        }
        if (options?.reorder) {
          const target = buildTargetOrder(state.items, importIds || [], options.removeExtra);
          await applyTargetOrder(target);
        }
      } else if (state.sortedItems) {
        await applyTargetOrder(state.sortedItems);
      }

      if (state.metaEdits.size) {
        await applyPendingMetadataEdits();
      }

      state.sortedItems = null;
      state.pendingImport = null;
      state.metaEdits.clear();
      renderRows();
      updatePreview();
      setStatus('Alterações salvas.');
    } catch (e) {
      console.error(e);
      setStatus(`Erro ao salvar: ${e.message || e}`);
    }
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

    tbody.querySelectorAll('.pp-meta-line').forEach(line => {
      line.addEventListener('click', () => {
        const field = line.getAttribute('data-field');
        const itemId = line.getAttribute('data-itemid');
        if (!field || !itemId) return;
        promptMetaEdit(itemId, field);
      });
    });

    tbody.querySelectorAll('.pp-editable').forEach(cell => {
      cell.addEventListener('click', () => {
        const field = cell.getAttribute('data-field');
        const itemId = cell.getAttribute('data-itemid');
        if (!field || !itemId) return;
        promptMetaEdit(itemId, field);
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

    el('ppSaveChanges').addEventListener('click', async () => {
      await saveChanges();
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

    const metaToggle = el('ppImportApplyMetadata');
    if (metaToggle) {
      metaToggle.addEventListener('change', () => {
        const metaFields = el('ppImportMetaFields');
        if (metaFields) metaFields.hidden = !metaToggle.checked;
      });
    }

    el('ppExport').addEventListener('click', async () => {
      try {
        await exportPlaylist();
      } catch (e) {
        console.error(e);
        setStatus(`Erro ao exportar: ${e.message || e}`);
      }
    });

    const importFile = el('ppImportFile');
    el('ppImport').addEventListener('click', () => {
      if (importFile) importFile.click();
    });
    if (importFile) {
      importFile.addEventListener('change', async () => {
        const file = importFile.files && importFile.files[0];
        if (!file) return;
        setStatus('Lendo arquivo de importação...');
        try {
          const data = await readJsonFile(file);
          await importPlaylist(data);
        } catch (e) {
          console.error(e);
          setStatus('Falha ao importar arquivo. Verifique o JSON.');
        } finally {
          importFile.value = '';
        }
      });
    }
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
