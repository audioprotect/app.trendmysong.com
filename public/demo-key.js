const demoKey = '54138';
  const storedKey = localStorage.getItem('key');

  if (storedKey === demoKey) {
    const currentPath = window.location.pathname.replace(/^\//, '');
    window.location.href = `/demo/${currentPath}`;
  }