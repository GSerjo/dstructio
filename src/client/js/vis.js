window.onload = function() {
    'use strict';

    // Allow for different screen size.
    if (isMobile()) {
        document.getElementById('howtoplay').style.height = '70%';
        document.getElementById('menuTitle').style.display = 'none';
    }
    else {
        document.getElementById('howtoplay').style.height = '50%';
        document.getElementById('menuTitle').style.display = 'block';
    }
};

function isMobile() {
    if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|BB|PlayBook|IEMobile|Windows Phone|Kindle|Silk|Opera Mini/i.test(navigator.userAgent)) {
        return true;
    }

    return false;
}
