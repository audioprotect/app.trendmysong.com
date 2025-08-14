const sideLinks = document.querySelectorAll('.sidebar .side-menu li a:not(.logout)');

sideLinks.forEach(item => {
    const li = item.parentElement;
    item.addEventListener('click', () => {
        sideLinks.forEach(i => {
            i.parentElement.classList.remove('active');
        })
        li.classList.add('active');
    })
});

const menuBar = document.querySelector('.content nav .bx.bx-menu');
const sideBar = document.querySelector('.sidebar');
const audioProtectText = document.getElementById('audioprotect'); // Select the text element

menuBar.addEventListener('click', () => {
    sideBar.classList.toggle('close');

    // Check if the sidebar is closed
    if (sideBar.classList.contains('close')) {
        // Slide the text out
        audioProtectText.classList.add('hide');
    } else {
        // Slide the text in
        audioProtectText.classList.remove('hide');
    }
});

const searchBtn = document.querySelector('.content nav form .form-input button');
const searchBtnIcon = document.querySelector('.content nav form .form-input button .bx');
const searchForm = document.querySelector('.content nav form');

searchBtn.addEventListener('click', function (e) {
    if (window.innerWidth < 576) {
        e.preventDefault;
        searchForm.classList.toggle('show');
        if (searchForm.classList.contains('show')) {
            searchBtnIcon.classList.replace('bx-search', 'bx-x');
        } else {
            searchBtnIcon.classList.replace('bx-x', 'bx-search');
        }
    }
});

window.addEventListener('resize', () => {
    if (window.innerWidth < 768) {
        sideBar.classList.add('close');
    } else {
        sideBar.classList.remove('close');
    }
    if (window.innerWidth > 576) {
        searchBtnIcon.classList.replace('bx-x', 'bx-search');
        searchForm.classList.remove('show');
    }
});



// Function to fetch the summary data
async function fetchSummary() {
    try {
        // Retrieve the key from localStorage
        const key = localStorage.getItem('key');

        // Check if the key is either null or an empty string
        if (!key || key === 'null') {
            console.error('Key not found');
            window.location.href = '/';
            return;
        }
      
        // Fetch track status data from the backend
        const statusResponse = await fetch(`/get-sheet-summary?key=${encodeURIComponent(key)}&sheetName=portal`);
        const data = await statusResponse.json(); // Parse JSON response

        if (!Array.isArray(data) || data.length === 0) {
            console.error('No data available');
            alert('No data available for the specified key');
            return;
        }

        // Extract the first entry from the JSON array
        const summary = data[0];

        // Display the fetched data in corresponding elements
        document.getElementById('copyrighted').textContent = summary['Copyrighted'] || 'N/A';
        document.getElementById('rejected').textContent = summary['Rejected'] || 'N/A';
        document.getElementById('review').textContent = summary['In Review'] || 'N/A';
        document.getElementById('progress').textContent = summary['In Progress'] || 'N/A';

    } catch (error) {
        console.error('Error fetching data:', error);
        alert('Error: Data Fetching (Contact the Support Team)');
    }
}

// Fetch summary and status data when the page loads
window.onload = function() {
    fetchSummary();
};
