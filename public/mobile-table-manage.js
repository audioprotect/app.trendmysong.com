document.addEventListener("DOMContentLoaded", function () {
    let currentUsername, currentKey;
    let useLocalStorage = false;
  
    try {
      if (typeof Storage !== "undefined" && localStorage) {
        currentUsername = localStorage.getItem("username");
        currentKey = localStorage.getItem("key");
        useLocalStorage = true;
      }
    } catch (e) {
      console.log("localStorage not available, using demo mode");
    }
  
    if (!useLocalStorage || !currentUsername || !currentKey) {
      currentUsername = "demo_user";
      currentKey = "demo_key";
    }
  
    const dataContainer = document.getElementById("dataContainer");
    const searchInput = document.getElementById("searchInput");
    const pageInfo = document.getElementById("pageInfo");
    const paginationContainer = document.getElementById("paginationContainer");
  
    let allData = [];
    let filteredData = [];
    let currentSort = "newest";
  
    const rowsPerPage = 5;
    let currentPage = 1;
    let totalPages = 1;
  
    function getStatusClass(status) {
      return {
        "Removed": "status-removed",
        "In Review": "status-review",
        "In Progress": "status-progress",
        "Copyrighted": "status-copyrighted",
        "Approved": "status-approved"
      }[status] || '';
    }
  
    function getTypeClass(type) {
      return {
        "Original Track": "type-original",
        "Cover Track": "type-cover",
        "Remix": "type-remix"
      }[type] || '';
    }
  
    function formatDate(dateString) {
      try {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: '2-digit'
        });
      } catch {
        return dateString || 'N/A';
      }
    }
  
    function renderMobileCards(data, page = 1) {
      if (!data || data.length === 0) {
        dataContainer.innerHTML = '<div class="no-data">No tracks found</div>';
        if (pageInfo) pageInfo.innerHTML = '';
        if (paginationContainer) paginationContainer.innerHTML = '';
        return;
      }
  
      const startIndex = (page - 1) * rowsPerPage;
      const endIndex = page * rowsPerPage;
      const currentPageData = data.slice(startIndex, endIndex);
  
      totalPages = Math.ceil(data.length / rowsPerPage);
      let cardsHTML = '<div class="mobile-cards">';
  
      currentPageData.forEach(row => {
        const safeRow = Array.from({ length: 9 }, (_, i) => row[i] || 'N/A');
        cardsHTML += `
          <div class="track-card">
            <div class="card-header">
              <div class="track-id">#${safeRow[1]}</div>
              <div class="track-status">
                <span class="${getStatusClass(row[0])}">${row[0] || 'N/A'}</span>
              </div>
            </div>
            <div class="card-content">
              <div class="track-title">${safeRow[5]}</div>
              <div class="track-artist">by ${safeRow[4]}</div>
              <div class="track-album">${safeRow[6]}</div>
              <div class="track-meta">
                <div class="track-date">${formatDate(safeRow[3])}</div>
                <div class="track-type">
                  <span class="${getTypeClass(safeRow[8])}">${safeRow[8]}</span>
                </div>
              </div>
              <div class="card-actions">
                <button class="mobile-play-button" onclick="playAudio('${safeRow[7]}')">▶ Play</button>
              </div>
            </div>
          </div>
        `;
      });
  
      cardsHTML += '</div>';
      dataContainer.innerHTML = cardsHTML;
      renderMobilePagination(data);
      updatePageInfo(data, page);
    }
  
    function updatePageInfo(data, page) {
      if (pageInfo) {
        const start = (page - 1) * rowsPerPage + 1;
        const end = Math.min(page * rowsPerPage, data.length);
        pageInfo.innerHTML = `${start}-${end} of ${data.length}`;
      }
    }
  
    function renderMobilePagination(data) {
      if (!paginationContainer) return;
  
      totalPages = Math.ceil(data.length / rowsPerPage);
      if (totalPages <= 1) {
        paginationContainer.innerHTML = '';
        return;
      }
  
      let html = `<div class="mobile-pagination">`;
      html += `<button class="mobile-page-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="changePage(${currentPage - 1})">‹</button>`;
      html += `<span class="page-info">${currentPage} / ${totalPages}</span>`;
      html += `<button class="mobile-page-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="changePage(${currentPage + 1})">›</button>`;
      html += `</div>`;
      paginationContainer.innerHTML = html;
    }
  
    function changePage(page) {
      if (page >= 1 && page <= totalPages) {
        currentPage = page;
        renderMobileCards(filteredData, currentPage);
      }
    }
  
    function sortByDate(data, ascending = true) {
      return [...data].sort((a, b) => {
        const dateA = new Date(a[3]);
        const dateB = new Date(b[3]);
        return isNaN(dateA) || isNaN(dateB)
          ? 0
          : ascending ? dateA - dateB : dateB - dateA;
      });
    }
  
    function updateSortButtons(activeSort) {
      document.querySelectorAll('.sort-button').forEach(btn => btn.classList.remove('active'));
      const activeBtn = document.getElementById(activeSort === 'oldest' ? 'sortOldToNew' : 'sortNewToOld');
      if (activeBtn) activeBtn.classList.add('active');
    }
  
    function filterAndRender() {
      const query = searchInput?.value.toLowerCase().trim() || '';
      filteredData = query
        ? allData.filter(row => (row[5] || '').toLowerCase().includes(query)
          || (row[4] || '').toLowerCase().includes(query)
          || (row[6] || '').toLowerCase().includes(query))
        : [...allData];
  
      filteredData = sortByDate(filteredData, currentSort === 'oldest');
      currentPage = 1;
      renderMobileCards(filteredData, currentPage);
    }
  
    const sortOldToNewBtn = document.getElementById('sortOldToNew');
    const sortNewToOldBtn = document.getElementById('sortNewToOld');
    sortOldToNewBtn?.addEventListener('click', () => {
      currentSort = 'oldest';
      updateSortButtons('oldest');
      filterAndRender();
    });
    sortNewToOldBtn?.addEventListener('click', () => {
      currentSort = 'newest';
      updateSortButtons('newest');
      filterAndRender();
    });
    searchInput?.addEventListener('input', filterAndRender);
  
    window.playAudio = function (audioUrl) {
      audioUrl && audioUrl !== 'N/A'
        ? window.open(audioUrl, '_blank')
        : alert('Audio file not available');
    };
    window.changePage = changePage;
  
    async function fetchData() {
      if (!useLocalStorage || !currentUsername || !currentKey) {
        dataContainer.innerHTML = '<div class="no-data">Please log in to view your tracks.</div>';
        return;
      }
  
      try {
        dataContainer.innerHTML = '<div class="loading">Loading...</div>';
        const response = await fetch(`/get-sheet-data?sheetName=${encodeURIComponent(currentUsername)}&key=${encodeURIComponent(currentKey)}`);
        if (!response.ok) throw new Error(`Error ${response.status}: Unable to fetch data`);
        const json = await response.json();
        if (!json.data || !Array.isArray(json.data)) throw new Error('Invalid data received');
  
        allData = json.data;
        filteredData = [...allData];
        filteredData = sortByDate(filteredData, false);
        updateSortButtons('newest');
        renderMobileCards(filteredData, currentPage);
  
      } catch (err) {
        dataContainer.innerHTML = `
          <div class="no-data">
            <h3>Unable to Load Data</h3>
            <p><strong>Error:</strong> ${err.message}</p>
            <button onclick="fetchData()" class="mobile-retry-btn">Retry</button>
          </div>`;
        console.error('Fetch error:', err);
      }
    }
  
    window.fetchData = fetchData;
    fetchData();
  });
  