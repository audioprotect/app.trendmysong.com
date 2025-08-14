document.addEventListener("DOMContentLoaded", function() {
  // Check for localStorage availability and get credentials
  let currentUsername, currentKey;
  let useLocalStorage = false;
  const style = document.createElement('style');
style.innerHTML = `
  .video-thumbnail {
    width: 160px;
    height: 90px;
    border-radius: 8px;
    object-fit: cover;
    display: block;
    transition: transform 0.3s ease;
    cursor: pointer;
  }

  .video-thumbnail:hover {
    transform: scale(1.05);
  }
`;
document.head.appendChild(style);

  
  try {
    if (typeof(Storage) !== "undefined" && localStorage) {
      currentUsername = localStorage.getItem('username');
      currentKey = localStorage.getItem('key');
      useLocalStorage = true;
    }
  } catch (e) {
    console.log('localStorage not available, using demo mode');
  }
  
  // Fallback to demo data if localStorage is not available
  if (!useLocalStorage || !currentUsername || !currentKey) {
    currentUsername = 'demo_user';
    currentKey = 'demo_key';
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

  // No demo data - rely on backend only

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
    <div class="header-cell">Video</div>
    <div class="header-cell">Claimed Track</div>
    <div class="header-cell">Artist</div>
    <div class="header-cell">Views</div>
    <div class="header-cell">Claim Date</div>
    <div class="header-cell">Watch Video</div>
    <div class="header-cell">Status</div>
  </div>
  `;

  function getYoutubeVideoId(url) {
    // Support formats like:
    // https://www.youtube.com/watch?v=VIDEO_ID
    // https://youtu.be/VIDEO_ID
    // https://www.youtube.com/embed/VIDEO_ID
    const regex = /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
  }
  
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
      const videoTitle = row['Track Title'] || 'N/A';
      const views = row['Views'] || 'N/A';
      const claimedSong = row['Artist'] || 'N/A';
      const claimType = 'YouTube';
      const uploadDate = formatDate(row['Report Date'] || 'N/A');
      const status = `
        <span style="
          display: inline-flex;
          align-items: center;
          background: linear-gradient(90deg, #fef08a 60%, #fde047 100%);
          color: #b45309;
          font-weight: bold;
          border-radius: 999px;
          box-shadow: 0 1px 6px 0 #fde04799, 0 0.5px 0 #facc15;
          font-size: 0.97em;
          gap: 0.4em;
          padding: 0.22em 0.8em 0.22em 0.7em;
          min-width: 0;
          width: auto;
          white-space: nowrap;
        ">
          <span style="font-size:1.13em; font-weight:bold; margin-right:0.22em;">$</span>
          Monetized
        </span>
      `;
      const videoUrl = row['Link'] || '#';
  
      // Extract YouTube video ID
      const videoId = getYoutubeVideoId(videoUrl);
      const thumbnailUrl = videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : '';
  
      tableHTML += `
        <div class="table-rows">
          <div class="table-cell" title="${videoTitle}">
            ${thumbnailUrl 
              ? `<a href="${videoUrl}" target="_blank" rel="noopener noreferrer">
              <img 
  src="${thumbnailUrl}" 
  alt="Thumbnail for ${videoTitle}" 
  class="video-thumbnail" 
  style="width: 80px; height: 45px; object-fit: cover; border-radius: 4px;" 
/>

              </a>`
              : '<span>No Thumbnail</span>'
            }
          </div>
          <div class="table-cell">${videoTitle}</div>
          <div class="table-cell">${claimedSong}</div>
          <div class="table-cell">${views}</div>
          <div class="table-cell">${uploadDate}</div>
          <div class="table-cell">
            <button class="play-button" onclick="window.open('${videoUrl}', '_blank')">▶ Watch</button>
          </div>
          <div class="table-cell">
            <span class="${getStatusClass(status)}">${status}</span>
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
        const title = (row['Track Title'] || '').toLowerCase();
        const artist = (row['Artist'] || '').toLowerCase();
        return title.includes(query) || artist.includes(query);
      });
    }
    
    // Sorting will need to sort by 'Report Date' property
    if (currentSort === 'oldest') {
      filteredData = [...filteredData].sort((a, b) => new Date(a['Report Date']) - new Date(b['Report Date']));
    } else {
      filteredData = [...filteredData].sort((a, b) => new Date(b['Report Date']) - new Date(a['Report Date']));
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

  async function fetchData() {
    const key = localStorage.getItem('key');
  
    if (!key) {
      dataContainer.innerHTML = '<div class="no-data">Missing login key</div>';
      return;
    }
  
    try {
      const response = await fetch(`/yt-claims?key=${encodeURIComponent(key)}`);
  
      if (!response.ok) throw new Error(`Failed to load data: ${response.status}`);
  
      const userData = await response.json();
  
      if (!userData || userData.length === 0) {
        dataContainer.innerHTML = '<div class="no-data">There are no reports currently available.</div>';
        return;
      }
  
      allData = userData;
      filteredData = sortByDate([...allData], false);
  
      updateSortButtons('newest');
      renderTable(filteredData, currentPage);
    } catch (error) {
      console.error(error);
      dataContainer.innerHTML = `<div class="no-data">Error: ${error.message}</div>`;
    }
  }
    

  // Make fetchData globally accessible for retry functionality
  window.fetchData = fetchData;

  // Initialize immediately
  fetchData();
});