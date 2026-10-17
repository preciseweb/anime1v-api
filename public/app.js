/* ==========================================================================
   ANIME1V STREAM - LÓGICA DE APLICACIÓN SPA (VANILLA JS & HLS.JS)
   Búsqueda Unificada | Resolución Multi-Servidor | Home Dinámico
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  
  // --- ELEMENTOS DEL DOM ---
  const searchInput = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-btn');
  const resultsGrid = document.getElementById('results-grid');
  const genreFilters = document.getElementById('genre-filters');
  const scrollSentinel = document.getElementById('scroll-sentinel');
  
  const viewTitle = document.getElementById('view-title');
  const viewSubtitle = document.getElementById('view-subtitle');
  
  // Vistas (SPA Panels)
  const searchView = document.getElementById('search-view');
  const detailView = document.getElementById('detail-view');
  const playerView = document.getElementById('player-view');
  
  // Botones de navegación
  const navHome = document.getElementById('nav-home');
  const navPopular = document.getElementById('nav-popular');
  const btnBackToSearch = document.getElementById('btn-back-to-search');
  const btnBackToDetail = document.getElementById('btn-back-to-detail');
  
  // Panel de Detalle del Anime
  const animeTitle = document.getElementById('anime-title');
  const animeDescription = document.getElementById('anime-description');
  const animeType = document.getElementById('anime-type');
  const animePoster = document.getElementById('anime-poster');
  const animeGenres = document.getElementById('anime-genres');
  const animeHeroBanner = document.getElementById('anime-hero-banner');
  const episodesGrid = document.getElementById('episodes-grid');
  
  // Panel del Reproductor
  const playingTitle = document.getElementById('playing-title');
  const playingSubtitle = document.getElementById('playing-subtitle');
  const videoLoader = document.getElementById('video-loader');
  const mainPlayer = document.getElementById('main-player');
  const serversList = document.getElementById('servers-list');
  const variantButtons = {
    SUB: document.getElementById('variant-sub-btn'),
    DUB: document.getElementById('variant-dub-btn')
  };
  const variantStatus = document.getElementById('variant-status');
  const playerPrevBtn = document.getElementById('player-prev-btn');
  const playerCatalogBtn = document.getElementById('player-catalog-btn');
  const playerExternalBtn = document.getElementById('player-external-btn');
  const playerNextBtn = document.getElementById('player-next-btn');
  
  // --- VARIABLES DE ESTADO ---
  let hlsInstance = null;
  let currentAnimeData = null;
  let currentEpisodeLinks = null;
  let currentEpisodeNumber = null;
  let preferredVariant = 'SUB';
  let currentVariant = 'SUB';
  let playbackVersion = 0;
  const playbackTimers = new Set();
  const requests = { info: null, episode: null, resolve: null };
  let catalogPage = 1;
  let catalogGenre = '';
  let catalogTitle = 'Catálogo';
  let catalogSubtitle = 'Explora el catálogo completo de anime';
  let isLoadingMore = false;
  let hasMorePages = true;
  let currentMode = 'catalog'; // 'catalog' | 'search'
  let infiniteObserver = null;
  
  const API_KEY = "dev-anime1v-key";
  
  const getHeaders = () => ({
    'Content-Type': 'application/json',
    'x-api-key': API_KEY
  });

  function cancelRequest(kind) {
    if (requests[kind]) requests[kind].abort();
    requests[kind] = null;
  }

  function beginRequest(kind) {
    cancelRequest(kind);
    const request = new AbortController();
    requests[kind] = request;
    return request;
  }

  function isCurrentRequest(kind, request) {
    return requests[kind] === request && !request.signal.aborted;
  }

  // --- NAVEGACIÓN Y CAMBIO DE PANTALLAS (SPA) ---
  function switchView(targetPanel) {
    if (targetPanel !== detailView) cancelRequest('info');
    if (targetPanel !== playerView) {
      cancelRequest('episode');
      cancelRequest('resolve');
      stopVideoPlayer();
    }
    
    [searchView, detailView, playerView].forEach(panel => {
      panel.classList.remove('active');
    });
    
    targetPanel.classList.add('active');

    // Mostrar/ocultar filtros de género según la vista
    if (targetPanel === searchView && currentMode === 'catalog') {
      genreFilters.style.display = 'flex';
    } else {
      genreFilters.style.display = 'none';
    }
  }

  // --- GENERACIÓN DE SKELETONS DE CARGA ---
  function showGridSkeletons(count = 12) {
    resultsGrid.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const skeleton = document.createElement('div');
      skeleton.className = 'skeleton-card';
      resultsGrid.appendChild(skeleton);
    }
  }

  function appendGridSkeletons(count = 4) {
    for (let i = 0; i < count; i++) {
      const skeleton = document.createElement('div');
      skeleton.className = 'skeleton-card';
      resultsGrid.appendChild(skeleton);
    }
  }

  function removeSkeletons() {
    document.querySelectorAll('.skeleton-card').forEach(s => s.remove());
  }

  // --- SCROLL INFINITO CON INTERSECTION OBSERVER ---
  function setupInfiniteScroll() {
    if (infiniteObserver) infiniteObserver.disconnect();
    
    infiniteObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && !isLoadingMore && hasMorePages && currentMode === 'catalog') {
          loadMoreCatalog();
        }
      }
    }, { rootMargin: '200px' });

    infiniteObserver.observe(scrollSentinel);
  }

  function showScrollSentinel() {
    scrollSentinel.classList.add('visible');
  }

  function hideScrollSentinel() {
    scrollSentinel.classList.remove('visible');
  }

  // --- 1. FUNCIÓN: HOME DINÁMICO (CATÁLOGO) ---
  async function loadCatalog(resetGrid = true) {
    currentMode = 'catalog';
    switchView(searchView);
    
    if (catalogGenre) {
      viewTitle.textContent = `Género: ${catalogGenre.charAt(0).toUpperCase() + catalogGenre.slice(1)}`;
      viewSubtitle.textContent = `Explorando el catálogo filtrado por género`;
    } else {
      viewTitle.textContent = catalogTitle;
      viewSubtitle.textContent = catalogSubtitle;
    }

    if (resetGrid) {
      catalogPage = 1;
      hasMorePages = true;
      showGridSkeletons();
    }

    try {
      let url = `/api/v1/anime/catalog?page=${catalogPage}`;
      if (catalogGenre) url += `&genre=${encodeURIComponent(catalogGenre)}`;
      
      const res = await fetch(url, { headers: getHeaders() });
      const responseData = await res.json();

      if (resetGrid) resultsGrid.innerHTML = '';

      if (responseData.success && responseData.data?.results?.length > 0) {
        appendAnimeCards(responseData.data.results, 'AnimeAV1');
        hasMorePages = responseData.data.hasMore;
        
        if (hasMorePages) {
          showScrollSentinel();
        } else {
          hideScrollSentinel();
        }
      } else {
        if (resetGrid) renderNoResults();
        hasMorePages = false;
        hideScrollSentinel();
      }
    } catch (err) {
      console.error('Error al cargar catálogo:', err);
      if (resetGrid) renderErrorView();
      hideScrollSentinel();
    }
  }

  async function loadMoreCatalog() {
    if (isLoadingMore || !hasMorePages) return;
    isLoadingMore = true;
    catalogPage++;
    
    appendGridSkeletons(4);

    try {
      let url = `/api/v1/anime/catalog?page=${catalogPage}`;
      if (catalogGenre) url += `&genre=${encodeURIComponent(catalogGenre)}`;
      
      const res = await fetch(url, { headers: getHeaders() });
      const responseData = await res.json();

      removeSkeletons();

      if (responseData.success && responseData.data?.results?.length > 0) {
        appendAnimeCards(responseData.data.results, 'AnimeAV1');
        hasMorePages = responseData.data.hasMore;
      } else {
        hasMorePages = false;
      }

      if (!hasMorePages) hideScrollSentinel();
    } catch (err) {
      console.error('Error al cargar más catálogo:', err);
      removeSkeletons();
      hasMorePages = false;
      hideScrollSentinel();
    } finally {
      isLoadingMore = false;
    }
  }

  // --- 2. FUNCIÓN: BUSCAR ANIMES (UNIFICADA — SIN SELECTOR DE PROVEEDOR) ---
  async function performSearch(query = '') {
    const q = query.trim();
    if (!q) return;

    currentMode = 'search';
    switchView(searchView);
    genreFilters.style.display = 'none';
    viewTitle.textContent = `Buscando "${q}"`;
    viewSubtitle.textContent = `Consultando todos los proveedores simultáneamente...`;
    showGridSkeletons();
    hideScrollSentinel();

    try {
      // No enviamos domain → el backend prueba TODOS los proveedores automáticamente
      const res = await fetch(`/api/v1/anime/search?q=${encodeURIComponent(q)}`, {
        headers: getHeaders()
      });
      const responseData = await res.json();

      if (responseData.success && responseData.data?.results?.length > 0) {
        const providerLabel = responseData.source || 'Multi';
        viewSubtitle.textContent = `${responseData.data.count} resultados encontrados (vía ${providerLabel})`;
        resultsGrid.innerHTML = '';
        appendAnimeCards(responseData.data.results, providerLabel);
      } else {
        renderNoResults();
      }
    } catch (err) {
      console.error('Error al realizar búsqueda:', err);
      renderErrorView();
    }
  }

  // Renderizar tarjetas de Anime (reutilizable para catálogo y búsqueda)
  function appendAnimeCards(results, providerLabel = '') {
    results.forEach(anime => {
      const card = document.createElement('div');
      card.className = 'anime-card';
      card.setAttribute('data-url', anime.url);
      
      const imageUrl = anime.image 
        ? `/api/v1/anime/image-proxy?url=${encodeURIComponent(anime.image)}&apiKey=${API_KEY}` 
        : '';

      const imgTag = imageUrl
        ? `<img src="${imageUrl}" class="card-image" alt="${anime.title}" loading="lazy">`
        : `<div class="card-image" style="background:var(--bg-tertiary);display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:13px;text-align:center;padding:12px;">${anime.title}</div>`;

      card.innerHTML = `
        <div class="card-image-wrapper">
          ${imgTag}
          <span class="card-badge">${anime.provider || providerLabel}</span>
        </div>
        <div class="card-content">
          <h4 class="card-title">${anime.title}</h4>
          <div class="card-meta">
            <span>${anime.type || 'Serie'}</span>
            <span>${anime.year || ''}</span>
          </div>
        </div>
      `;

      card.addEventListener('click', () => {
        loadAnimeDetail(anime.url);
      });

      resultsGrid.appendChild(card);
    });
  }

  function renderNoResults() {
    resultsGrid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 48px; color: var(--text-muted);">
        <i class="fa-solid fa-face-frown" style="font-size: 48px; margin-bottom: 16px; color: var(--accent-purple);"></i>
        <h3>No se encontraron resultados</h3>
        <p>Intenta con otros términos de búsqueda.</p>
      </div>
    `;
  }

  function renderErrorView() {
    resultsGrid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 48px; color: var(--text-muted);">
        <i class="fa-solid fa-triangle-exclamation" style="font-size: 48px; margin-bottom: 16px; color: #ff3838;"></i>
        <h3>Error al consultar la API</h3>
        <p>El servidor puede estar offline o los proveedores están bloqueando la petición.</p>
      </div>
    `;
  }

  // --- 3. FUNCIÓN: CARGAR DETALLES DEL ANIME ---
  async function loadAnimeDetail(animeUrl) {
    switchView(detailView);
    const request = beginRequest('info');
    currentAnimeData = null;
    currentEpisodeLinks = null;
    currentEpisodeNumber = null;
    
    animeTitle.textContent = "Cargando detalles...";
    animeDescription.textContent = "Obteniendo información del catálogo...";
    animeType.textContent = "Anime";
    animePoster.style.backgroundImage = 'none';
    animeGenres.innerHTML = '';
    episodesGrid.innerHTML = '<div style="grid-column:1/-1; text-align:center;">Cargando lista de capítulos...</div>';

    try {
      const res = await fetch(`/api/v1/anime/info?url=${encodeURIComponent(animeUrl)}`, {
        headers: getHeaders(),
        signal: request.signal
      });
      const responseData = await res.json();
      if (!isCurrentRequest('info', request)) return;

      if (responseData.success && responseData.data) {
        currentAnimeData = responseData.data;
        renderAnimeDetail(currentAnimeData);
      } else {
        animeTitle.textContent = "Error al cargar";
        animeDescription.textContent = "No se pudo recuperar la información del anime.";
      }
    } catch (err) {
      if (!isCurrentRequest('info', request)) return;
      console.error('Error al cargar detalle:', err);
      animeTitle.textContent = "Error";
      animeDescription.textContent = "Ocurrió una falla de red al contactar con el backend.";
    }
  }

  function renderAnimeDetail(data) {
    animeTitle.textContent = data.title;
    animeDescription.textContent = data.description || 'Sin sinopsis disponible.';
    animeType.textContent = data.type || 'Serie';
    
    // Póster
    const posterUrl = data.image 
      ? `/api/v1/anime/image-proxy?url=${encodeURIComponent(data.image)}&apiKey=${API_KEY}` 
      : '';
    animePoster.style.backgroundImage = posterUrl ? `url('${posterUrl}')` : 'none';
    
    // Géneros
    animeGenres.innerHTML = '';
    if (data.genres && data.genres.length > 0) {
      data.genres.forEach(genre => {
        const tag = document.createElement('span');
        tag.className = 'genre-tag';
        tag.textContent = genre.name;
        animeGenres.appendChild(tag);
      });
    }

    // Episodios
    episodesGrid.innerHTML = '';
    if (data.episodes && data.episodes.length > 0) {
      const sortedEps = [...data.episodes].sort((a, b) => a.number - b.number);
      
      sortedEps.forEach(ep => {
        const btn = document.createElement('button');
        btn.className = 'episode-btn';
        btn.innerHTML = `<i class="fa-solid fa-play" style="font-size:12px; margin-right:4px;"></i> Ep ${ep.number}`;
        
        btn.addEventListener('click', () => {
          if (currentAnimeData === data) playEpisode(ep.url, ep.number);
        });
        
        episodesGrid.appendChild(btn);
      });
    } else {
      episodesGrid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color:var(--text-muted);">No se encontraron episodios disponibles para ver online.</div>';
    }
  }

  // --- 4. EPISODIOS Y SERVIDORES POR IDIOMA ---
  function normalizeEpisodeServers(data) {
    const groups = { SUB: [], DUB: [] };
    for (const variant of Object.keys(groups)) {
      const seen = new Set();
      const lists = [data.servers?.[variant.toLowerCase()], data.streamLinks?.[variant]];
      for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (const server of list) {
          const url = typeof server?.url === 'string' ? server.url.trim() : '';
          if (!url || seen.has(url)) continue;
          seen.add(url);
          groups[variant].push({ ...server, url, server: server.server || 'Servidor' });
        }
      }
    }
    return groups;
  }

  function renderVariantButtons() {
    for (const [variant, button] of Object.entries(variantButtons)) {
      const count = currentEpisodeLinks?.[variant].length || 0;
      const label = variant === 'SUB' ? 'Subtitulado' : 'Doblado';
      button.textContent = `${variant} · ${label} (${currentEpisodeLinks ? count : '…'})`;
      button.disabled = !count;
      button.classList.toggle('active', Boolean(count && currentVariant === variant));
      button.setAttribute('aria-pressed', String(Boolean(count && currentVariant === variant)));
    }
    if (!currentEpisodeLinks) {
      variantStatus.textContent = 'Consultando disponibilidad de idiomas…';
      return;
    }
    const count = currentEpisodeLinks[currentVariant].length;
    const unavailable = currentVariant !== preferredVariant
      ? `${preferredVariant} no disponible para este episodio. ` : '';
    variantStatus.textContent = count
      ? `${unavailable}${count} servidor${count === 1 ? '' : 'es'} en ${currentVariant}.`
      : 'No hay servidores SUB ni DUB disponibles para este episodio.';
  }

  function showPlayerMessage(message, loading = false) {
    videoLoader.innerHTML = '';
    if (loading) {
      const spinner = document.createElement('div');
      spinner.className = 'spinner';
      videoLoader.appendChild(spinner);
    }
    const text = document.createElement('p');
    text.textContent = message;
    videoLoader.appendChild(text);
    videoLoader.style.opacity = '1';
    videoLoader.style.pointerEvents = 'all';
  }

  function hidePlayerMessage() {
    videoLoader.style.opacity = '0';
    videoLoader.style.pointerEvents = 'none';
  }

  function showPlaybackStatus(serverName, embedded = false) {
    playingSubtitle.textContent = `Episodio ${currentEpisodeNumber} · ${currentVariant} — ${serverName}${embedded ? ' (reproductor externo)' : ''}`;
  }

  async function playEpisode(episodeUrl, episodeNumber) {
    const anime = currentAnimeData;
    if (!anime || !anime.episodes?.some(ep => ep.url === episodeUrl)) return;
    switchView(playerView);
    cancelRequest('resolve');
    stopVideoPlayer();
    const request = beginRequest('episode');
    currentEpisodeLinks = null;
    currentEpisodeNumber = episodeNumber;
    playingTitle.textContent = anime.title;
    playingSubtitle.textContent = `Cargando Episodio ${episodeNumber}...`;
    renderVariantButtons();

    const eps = [...anime.episodes].sort((a, b) => Number(a.number) - Number(b.number));
    const currentIdx = eps.findIndex(ep => ep.url === episodeUrl);
    const prevEp = currentIdx > 0 ? eps[currentIdx - 1] : null;
    const nextEp = currentIdx >= 0 ? eps[currentIdx + 1] : null;
    for (const [button, episode] of [[playerPrevBtn, prevEp], [playerNextBtn, nextEp]]) {
      button.disabled = !episode;
      button.onclick = episode ? () => {
        if (currentAnimeData === anime) playEpisode(episode.url, episode.number);
      } : null;
    }
    playerCatalogBtn.onclick = () => switchView(searchView);

    showPlayerMessage(`Obteniendo servidores del episodio ${episodeNumber}...`, true);
    serversList.textContent = 'Consultando servidores de video...';

    try {
      const res = await fetch(`/api/v1/anime/episode?url=${encodeURIComponent(episodeUrl)}`, {
        headers: getHeaders(), signal: request.signal
      });
      const responseData = await res.json();
      if (!isCurrentRequest('episode', request)) return;
      if (!responseData.success || !responseData.data) throw new Error('No se encontraron servidores');
      currentEpisodeLinks = normalizeEpisodeServers(responseData.data);
      currentVariant = currentEpisodeLinks[preferredVariant].length ? preferredVariant
        : currentEpisodeLinks.SUB.length ? 'SUB' : currentEpisodeLinks.DUB.length ? 'DUB' : preferredVariant;
      renderVariantButtons();
      resolveMultiServer(currentEpisodeLinks[currentVariant]);
    } catch (err) {
      if (!isCurrentRequest('episode', request)) return;
      currentEpisodeLinks = { SUB: [], DUB: [] };
      renderVariantButtons();
      serversList.textContent = '';
      playingSubtitle.textContent = 'No se pudieron obtener los servidores';
      showPlayerMessage('No se pudieron cargar los servidores de este episodio. Vuelve a seleccionarlo para reintentar.');
    }
  }

  for (const [variant, button] of Object.entries(variantButtons)) {
    button.addEventListener('click', () => {
      if (!currentEpisodeLinks?.[variant].length || currentVariant === variant) return;
      preferredVariant = variant;
      currentVariant = variant;
      renderVariantButtons();
      resolveMultiServer(currentEpisodeLinks[variant]);
    });
  }

  function isDirectMedia(url) {
    return /\.(?:m3u8|mp4)(?:[?#]|$)/i.test(url);
  }

  function supportsDirectResolution(server) {
    return /voe|wish|tape|playnix|medix|niramirus|kravaxxa|davioad|haxlopp|tryzendm|dumbalag|dhcplay|hglink|vidhide|hqq|netu|waaw|mixdrop|mxdcontent|dood|dstream|ds2play|dropload|dr0pstream|drop\.download|mp4upload/i.test(`${server.server} ${server.url}`);
  }

  function setServerStates(servers, activeUrl = null, tryingUrls = []) {
    serversList.querySelectorAll('.server-btn').forEach(button => {
      const server = servers[Number(button.getAttribute('data-idx'))];
      button.classList.toggle('active', server?.url === activeUrl);
      button.classList.toggle('server-trying', tryingUrls.includes(server?.url));
    });
  }

  // Promise.any devuelve el primero que responde; no informa cuáles fallaron.
  async function resolveMultiServer(servers) {
    cancelRequest('resolve');
    stopVideoPlayer();
    renderAllServerButtons(servers);
    if (!servers.length) {
      playingSubtitle.textContent = `Episodio ${currentEpisodeNumber} · Sin servidores`;
      showPlayerMessage('No hay reproductores disponibles para este episodio.');
      return;
    }

    const direct = servers.find(server => isDirectMedia(server.url));
    if (direct) {
      setServerStates(servers, direct.url);
      showPlaybackStatus(direct.server);
      hidePlayerMessage();
      startVideoPlayer(direct.url, /\.m3u8(?:[?#]|$)/i.test(direct.url) ? 'hls' : 'mp4', direct.url);
      return;
    }

    const supportedServers = servers.filter(supportsDirectResolution);
    if (!supportedServers.length) {
      setServerStates(servers, servers[0].url);
      showPlaybackStatus(servers[0].server, true);
      loadIframePlayer(servers[0].url);
      return;
    }

    const request = beginRequest('resolve');
    const urls = supportedServers.map(server => server.url);
    showPlayerMessage(`Buscando reproducción directa en ${supportedServers.length} servidor${supportedServers.length === 1 ? '' : 'es'} de ${currentVariant}...`, true);
    setServerStates(servers, null, urls);
    try {
      const res = await fetch(`/api/v1/anime/resolve?urls=${encodeURIComponent(JSON.stringify(urls))}`, {
        headers: getHeaders(), signal: request.signal
      });
      const responseData = await res.json();
      if (!isCurrentRequest('resolve', request)) return;
      const winner = supportedServers.find(server => server.url === responseData.resolvedFrom);
      if (!responseData.success || !responseData.streamUrl || !winner) throw new Error('No se devolvió un stream del grupo seleccionado');
      setServerStates(servers, winner.url);
      showPlaybackStatus(winner.server);
      hidePlayerMessage();
      startVideoPlayer(responseData.streamUrl, responseData.mediaType, winner.url);
    } catch (err) {
      if (!isCurrentRequest('resolve', request)) return;
      // Una falla de resolución directa no impide usar o reintentar el embed.
      setServerStates(servers, servers[0].url);
      showPlaybackStatus(servers[0].server, true);
      loadIframePlayer(servers[0].url);
    }
  }

  function renderAllServerButtons(servers) {
    serversList.innerHTML = '';
    const episodeRequest = requests.episode;
    servers.forEach((server, idx) => {
      const button = document.createElement('button');
      button.className = 'server-btn';
      button.setAttribute('data-idx', idx);
      button.textContent = server.server;
      button.addEventListener('click', () => {
        if (requests.episode !== episodeRequest || currentEpisodeLinks?.[currentVariant] !== servers) return;
        cancelRequest('resolve');
        stopVideoPlayer();
        setServerStates(servers, server.url);
        if (isDirectMedia(server.url)) {
          showPlaybackStatus(server.server);
          hidePlayerMessage();
          startVideoPlayer(server.url, /\.m3u8(?:[?#]|$)/i.test(server.url) ? 'hls' : 'mp4', server.url);
        } else if (supportsDirectResolution(server)) {
          resolveSingleServer(server, servers);
        } else {
          showPlaybackStatus(server.server, true);
          loadIframePlayer(server.url);
        }
      });
      serversList.appendChild(button);
    });
  }

  async function resolveSingleServer(server, servers) {
    const request = beginRequest('resolve');
    showPlayerMessage(`Resolviendo ${server.server} en ${currentVariant}...`, true);
    setServerStates(servers, server.url, [server.url]);
    try {
      const res = await fetch(`/api/v1/anime/resolve?url=${encodeURIComponent(server.url)}`, {
        headers: getHeaders(), signal: request.signal
      });
      const responseData = await res.json();
      if (!isCurrentRequest('resolve', request)) return;
      if (!responseData.success || !responseData.streamUrl || (responseData.resolvedFrom && responseData.resolvedFrom !== server.url)) {
        throw new Error('No se devolvió un enlace del servidor seleccionado');
      }
      setServerStates(servers, server.url);
      showPlaybackStatus(server.server);
      hidePlayerMessage();
      startVideoPlayer(responseData.streamUrl, responseData.mediaType, server.url);
    } catch (err) {
      if (!isCurrentRequest('resolve', request)) return;
      setServerStates(servers, server.url);
      showPlaybackStatus(server.server, true);
      loadIframePlayer(server.url);
    }
  }

  // --- 5. REPRODUCCIÓN: CADA SELECCIÓN INVALIDA LOS EVENTOS ANTERIORES ---
  function startVideoPlayer(url, mediaType, fallbackUrl = null) {
    stopVideoPlayer();
    const version = playbackVersion;
    const isCurrent = () => version === playbackVersion;
    if (fallbackUrl) {
      playerExternalBtn.style.display = 'flex';
      playerExternalBtn.href = fallbackUrl;
    }
    mainPlayer.style.display = 'block';

    let fallbackTriggered = false;
    const triggerFallback = () => {
      if (!isCurrent() || fallbackTriggered) return;
      fallbackTriggered = true;
      if (fallbackUrl) {
        playingSubtitle.textContent = `Episodio ${currentEpisodeNumber} · ${currentVariant} — Reproductor externo`;
        loadIframePlayer(fallbackUrl);
      } else {
        stopVideoPlayer();
        showPlayerMessage('No se pudo reproducir el video. Prueba otro servidor.');
      }
    };
    const playIfCurrent = () => {
      if (isCurrent()) mainPlayer.play().catch(() => {});
    };
    mainPlayer.onerror = triggerFallback;

    if (mediaType === 'hls') {
      if (typeof Hls !== 'undefined' && Hls.isSupported()) {
        const instance = new Hls({
          maxMaxBufferLength: 30,
          enableWorker: true,
          manifestLoadingMaxRetry: 3,
          levelLoadingMaxRetry: 3,
          fragLoadingMaxRetry: 3
        });
        hlsInstance = instance;
        instance.on(Hls.Events.MANIFEST_PARSED, playIfCurrent);
        instance.on(Hls.Events.ERROR, (event, data) => {
          if (!isCurrent() || hlsInstance !== instance || !data.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            instance.startLoad();
            const timer = setTimeout(() => {
              playbackTimers.delete(timer);
              if (isCurrent() && (mainPlayer.paused || mainPlayer.readyState === 0)) triggerFallback();
            }, 4000);
            playbackTimers.add(timer);
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            instance.recoverMediaError();
          } else {
            triggerFallback();
          }
        });
        instance.loadSource(url);
        instance.attachMedia(mainPlayer);
      } else if (mainPlayer.canPlayType('application/vnd.apple.mpegurl')) {
        mainPlayer.onloadedmetadata = playIfCurrent;
        mainPlayer.src = url;
        mainPlayer.load();
      } else {
        triggerFallback();
      }
    } else {
      mainPlayer.oncanplay = playIfCurrent;
      mainPlayer.src = url;
      mainPlayer.load();
    }
  }

  function stopVideoPlayer() {
    playbackVersion++;
    playbackTimers.forEach(timer => clearTimeout(timer));
    playbackTimers.clear();
    mainPlayer.onerror = null;
    mainPlayer.oncanplay = null;
    mainPlayer.onloadedmetadata = null;
    const instance = hlsInstance;
    hlsInstance = null;
    if (instance) instance.destroy();
    mainPlayer.pause();
    mainPlayer.removeAttribute('src');
    mainPlayer.load();
    playerExternalBtn.style.display = 'none';
    playerExternalBtn.href = '#';
    const iframe = document.getElementById('iframe-player');
    if (iframe) {
      iframe.src = 'about:blank';
      iframe.remove();
    }
  }

  function loadIframePlayer(embedUrl) {
    stopVideoPlayer();
    mainPlayer.style.display = 'none';
    const iframe = document.createElement('iframe');
    iframe.id = 'iframe-player';
    iframe.src = embedUrl;
    playerExternalBtn.style.display = 'flex';
    playerExternalBtn.href = embedUrl;
    iframe.title = `Reproductor ${currentVariant} del episodio ${currentEpisodeNumber}`;
    iframe.style.position = 'absolute';
    iframe.style.top = '0';
    iframe.style.left = '0';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.setAttribute('allowfullscreen', 'true');
    document.getElementById('video-container').appendChild(iframe);
    hidePlayerMessage();
  }

  // --- FILTROS DE GÉNERO ---
  genreFilters.addEventListener('click', (e) => {
    const chip = e.target.closest('.genre-chip');
    if (!chip) return;
    
    document.querySelectorAll('.genre-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    
    catalogGenre = chip.getAttribute('data-genre') || '';
    loadCatalog(true);
  });

  // --- VÍNCULOS Y NAVEGACIÓN GENERAL ---
  searchBtn.addEventListener('click', () => performSearch(searchInput.value));
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') performSearch(searchInput.value);
  });

  navHome.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    navHome.classList.add('active');
    searchInput.value = '';
    catalogTitle = 'Catálogo';
    catalogSubtitle = 'Explora el catálogo completo de anime';
    catalogGenre = '';
    document.querySelectorAll('.genre-chip').forEach(c => c.classList.remove('active'));
    document.querySelector('.genre-chip[data-genre=""]').classList.add('active');
    loadCatalog(true);
  });

  navPopular.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    navPopular.classList.add('active');
    searchInput.value = '';
    catalogTitle = 'Tendencias';
    catalogSubtitle = 'Los animes más populares y recomendados del catálogo';
    catalogGenre = '';
    document.querySelectorAll('.genre-chip').forEach(c => c.classList.remove('active'));
    document.querySelector('.genre-chip[data-genre=""]').classList.add('active');
    loadCatalog(true);
  });

  btnBackToSearch.addEventListener('click', () => {
    switchView(searchView);
  });

  btnBackToDetail.addEventListener('click', () => {
    switchView(detailView);
  });

  // --- CARGA INICIAL ---
  loadCatalog(true);
  setupInfiniteScroll();
});
