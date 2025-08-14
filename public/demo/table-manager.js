document.addEventListener("DOMContentLoaded", function() {
  // Check for localStorage availability and get credentials
  let currentUsername, currentKey;
  let useLocalStorage = false;
  
  try {
    if (typeof(Storage) !== "undefined" && localStorage) {
      currentUsername = localStorage.getItem('username');
      currentKey = localStorage.getItem('key');
      useLocalStorage = true;
    }
  } catch (e) {
    console.log('localStorage not available, using demo mode');
  }
  
  
  const dataContainer = document.getElementById('dataContainer');
  const searchInput = document.getElementById('searchInput');
  const pageInfo = document.getElementById('pageInfo');
  
  let allData = [];
  let filteredData = [];
  let currentSort = 'newest';
  
  const rowsPerPage = 8;
  let currentPage = 1;
  let totalPages = 1;


  function getStatusClass(status) {
    const statusMap = {
      'Removed': 'status-removed',
      'In Review': 'status-review', 
      'In Progress': 'status-progress',
      'Copyrighted': 'status-copyrighted',
      'Approved': 'status-approved'
    };
    return statusMap[status] || '';
  }
  
  function getTypeClass(type) {
    const typeMap = {
      'Original Track': 'type-original',
      'Cover Track': 'type-cover',
      'Remix': 'type-remix'
    };
    return typeMap[type] || '';
  }
  
  function formatDate(dateString) {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', { 
        year: 'short', 
        month: 'short', 
        day: 'numeric' 
      });
    } catch {
      return dateString || 'N/A';
    }
  }

  const tableHeader = `
    <div class="table-header">
      <div class="header-cell">Track ID</div>
      <div class="header-cell">Title</div>
      <div class="header-cell">Artist</div>
      <div class="header-cell">Album</div>
      <div class="header-cell">Release Date</div>
      <div class="header-cell">Track Type</div>
      <div class="header-cell">Audio</div>
      <div class="header-cell">Status</div>
    </div>
  `;

  function renderTable(data, page = 1) {
    if (!data || data.length === 0) {
      dataContainer.innerHTML = '<div class="no-data">No tracks found</div>';
      if (pageInfo) pageInfo.innerHTML = '';
      const paginationContainer = document.getElementById('paginationContainer');
      if (paginationContainer) paginationContainer.innerHTML = '';
      return;
    }

    const startIndex = (page - 1) * rowsPerPage;
    const endIndex = page * rowsPerPage;
    const currentPageData = data.slice(startIndex, endIndex);
    
    totalPages = Math.ceil(data.length / rowsPerPage);

    let tableHTML = tableHeader;
    
    currentPageData.forEach(row => {
      // Ensure row has at least 9 elements
      const safeRow = Array.from({ length: 9 }, (_, i) => row[i] || 'N/A');
      
      tableHTML += `
        <div class="table-rows">
          <div class="table-cell">
            <span class="table-cell-highlight">${safeRow[1]}</span>
          </div>
          <div class="table-cell" title="${safeRow[5]}">
            ${safeRow[5].length > 20 ? safeRow[5].substring(0, 20) + '...' : safeRow[5]}
          </div>
          <div class="table-cell" title="${safeRow[4]}">
            ${safeRow[4].length > 20 ? safeRow[4].substring(0, 20) + '...' : safeRow[4]}
          </div>
          <div class="table-cell" title="${safeRow[6]}">
            ${safeRow[6].length > 20 ? safeRow[6].substring(0, 20) + '...' : safeRow[6]}
          </div>
          <div class="table-cell">
            ${formatDate(safeRow[3])}
          </div>
          <div class="table-cell">
            <span class="image-cover">${safeRow[8]}</span>
          </div>
          <div class="table-cell">
            <button class="play-button" onclick="playAudio('${safeRow[7]}')">
              ▶ Play
            </button>
          </div>
          <div class="table-cell"> 
            <span class="${row[0] === 'Removed' ? 'red' : row[0] === 'In Review' ? 'blue' : row[0] === 'In Progress' ? 'yellow' : row[0] === 'Copyrighted' ? 'green' : ''}">${row[0] || 'N/A'}</span></div>
          </div>
        </div>
      `;
    });

    dataContainer.innerHTML = tableHTML;
    renderPaginationControls(data);
    updatePageInfo(data, page);
  }
  
  function updatePageInfo(data, page) {
    if (pageInfo) {
      const startIndex = (page - 1) * rowsPerPage + 1;
      const endIndex = Math.min(page * rowsPerPage, data.length);
      pageInfo.innerHTML = `Showing ${startIndex}-${endIndex} of ${data.length} tracks`;
    }
  }

  function renderPaginationControls(data) {
    const paginationContainer = document.getElementById('paginationContainer');
    if (!paginationContainer) return;
    
    totalPages = Math.ceil(data.length / rowsPerPage);

    if (totalPages <= 1) {
      paginationContainer.innerHTML = '';
      return;
    }

    let paginationHTML = '';

    // Previous button
    paginationHTML += `
      <button class="pagination-button" ${currentPage === 1 ? 'disabled' : ''} onclick="changePage(${currentPage - 1})">
        Previous
      </button>
    `;

    // Page numbers
    for (let i = 1; i <= totalPages; i++) {
      if (i === currentPage) {
        paginationHTML += `
          <button class="pagination-button" style="background: #4ade80; color: #111714; border-color: #4ade80;" disabled>
            ${i}
          </button>
        `;
      } else if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
        paginationHTML += `
          <button class="pagination-button" onclick="changePage(${i})">
            ${i}
          </button>
        `;
      } else if (i === currentPage - 2 || i === currentPage + 2) {
        paginationHTML += `<span class="pagination-button" style="background: transparent; border: none; cursor: default;">...</span>`;
      }
    }

    // Next button
    paginationHTML += `
      <button class="pagination-button" ${currentPage === totalPages ? 'disabled' : ''} onclick="changePage(${currentPage + 1})">
        Next
      </button>
    `;

    paginationContainer.innerHTML = paginationHTML;
  }

  function changePage(page) {
    if (page >= 1 && page <= totalPages) {
      currentPage = page;
      renderTable(filteredData, currentPage);
    }
  }

  function sortByDate(data, ascending = true) {
    return [...data].sort((a, b) => {
      const dateA = new Date(a[3]);
      const dateB = new Date(b[3]);
      
      // Handle invalid dates
      const validDateA = !isNaN(dateA.getTime());
      const validDateB = !isNaN(dateB.getTime());
      
      if (!validDateA && !validDateB) return 0;
      if (!validDateA) return 1;
      if (!validDateB) return -1;
      
      return ascending ? dateA - dateB : dateB - dateA;
    });
  }

  function updateSortButtons(activeSort) {
    // Remove active class from all sort buttons
    const allSortButtons = document.querySelectorAll('.sort-button');
    allSortButtons.forEach(btn => {
      btn.classList.remove('active');
    });
    
    // Add active class to the correct button
    if (activeSort === 'oldest') {
      const oldToNewBtn = document.getElementById('sortOldToNew');
      if (oldToNewBtn) {
        oldToNewBtn.classList.add('active');
      }
    } else if (activeSort === 'newest') {
      const newToOldBtn = document.getElementById('sortNewToOld');
      if (newToOldBtn) {
        newToOldBtn.classList.add('active');
      }
    }
  }

  function filterAndRender() {
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
    
    if (query === '') {
      filteredData = [...allData];
    } else {
      filteredData = allData.filter(row => {
        const title = (row[5] || '').toLowerCase();
        const artist = (row[4] || '').toLowerCase();
        const album = (row[6] || '').toLowerCase();
        return title.includes(query) || artist.includes(query) || album.includes(query);
      });
    }
    
    // Apply current sort
    if (currentSort === 'oldest') {
      filteredData = sortByDate(filteredData, true);
    } else {
      filteredData = sortByDate(filteredData, false);
    }
    
    currentPage = 1;
    renderTable(filteredData, currentPage);
  }

  // Event listeners
  const sortOldToNewBtn = document.getElementById('sortOldToNew');
  const sortNewToOldBtn = document.getElementById('sortNewToOld');
  
  if (sortOldToNewBtn) {
    sortOldToNewBtn.addEventListener('click', function() {
      console.log('Sort: Oldest to Newest clicked');
      currentSort = 'oldest';
      updateSortButtons('oldest');
      filterAndRender();
    });
  }

  if (sortNewToOldBtn) {
    sortNewToOldBtn.addEventListener('click', function() {
      console.log('Sort: Newest to Oldest clicked');
      currentSort = 'newest';
      updateSortButtons('newest');
      filterAndRender();
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', filterAndRender);
  }

  // Global functions for audio playback and pagination
  window.playAudio = function(audioUrl) {
    if (audioUrl && audioUrl !== 'N/A') {
      window.open(audioUrl, '_blank');
    } else {
      alert('Audio file not available');
    }
  };

  window.changePage = changePage;

  // Fast data fetching function
  async function fetchData() {
    try {
      // Show minimal loading state
      dataContainer.innerHTML = '<div class="loading">Loading...</div>';
      
      console.log('Fetching data from backend...');
      
      const response = await fetch(`/get-sheet-data?sheetName=${encodeURIComponent(currentUsername)}&key=${encodeURIComponent(currentKey)}`);
      
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('Authentication failed. Please log in again.');
        } else if (response.status === 404) {
          throw new Error('Data not found. Please contact support.');
        } else if (response.status >= 500) {
          throw new Error('Server error. Please try again later.');
        } else {
          throw new Error(`Request failed with status ${response.status}`);
        }
      }
      
      const data = await response.json();
      
      if (!data || !data.data || !Array.isArray(data.data)) {
        throw new Error('Invalid data format received');
      }

      allData = data.data;
      filteredData = [...allData];
      
      console.log('Data loaded:', allData.length, 'tracks');
      
      // Apply default sort and render immediately
      filteredData = sortByDate(filteredData, false);
      updateSortButtons('newest');
      renderTable(filteredData, currentPage);
      
    } catch (error) {
      console.error('Fetch error:', error);
      
      dataContainer.innerHTML = `
        <div class="no-data">
          <h3>Unable to Load Data</h3>
          <p><strong>Error:</strong> ${error.message}</p>
          <button onclick="fetchData()" style="margin-top: 10px; padding: 8px 16px; background: #4ade80; color: #111714; border: none; border-radius: 4px; cursor: pointer;">
            Retry
          </button>
        </div>
      `;
    }
  }

  // Make fetchData globally accessible for retry functionality
  window.fetchData = fetchData;

  // Initialize immediately
  fetchData();
});