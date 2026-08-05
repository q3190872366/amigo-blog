/**
 * Live Photo 组件 - 统一初始化和交互
 * 支持单张或多张实况图
 */

function initLivePhotoComponents(container) {
    var scope = container || document;
    var elements = scope.querySelectorAll('.live-photo');
    
    elements.forEach(function(el) {
        if (el.dataset.liveInit) return; // 已初始化
        el.dataset.liveInit = 'true';
        
        initSingleLivePhoto(el);
    });
}

function initSingleLivePhoto(container) {
    var video = container.querySelector('.live-photo-video');
    var poster = container.querySelector('.live-photo-poster');
    var muteBtn = container.querySelector('.live-photo-mute-btn');
    
    // 设置视频源
    if (video && video.dataset.src) {
        video.src = video.dataset.src;
    }
    
    // 点击播放/暂停
    container.addEventListener('click', function(e) {
        // 排除静音按钮的点击
        if (e.target.closest('.live-photo-mute-btn')) return;
        
        if (!video) return;
        
        if (video.paused) {
            var isMuted = getMutedState(container);
            video.muted = isMuted;
            
            var playPromise = video.play();
            if (playPromise !== undefined) {
                playPromise.catch(function() {
                    // 自动播放被阻止，尝试静音播放
                    video.muted = true;
                    video.play().catch(function() {});
                });
            }
        } else {
            video.pause();
        }
    });
    
    // 静音按钮点击
    if (muteBtn) {
        muteBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            toggleMute(container);
        });
    }
    
    // 视频事件
    if (video) {
        video.addEventListener('play', function() {
            if (poster) poster.style.opacity = '0';
        });
        
        video.addEventListener('pause', function() {
            if (poster) poster.style.opacity = '1';
        });
        
        video.addEventListener('ended', function() {
            if (poster) poster.style.opacity = '1';
            container.classList.add('video-ended');
            video.currentTime = 0;
        });
    }
}

function getMutedState(container) {
    var btn = container.querySelector('.live-photo-mute-btn');
    return btn ? btn.dataset.muted === 'true' : true;
}

function toggleMute(container) {
    var video = container.querySelector('.live-photo-video');
    var muteBtn = container.querySelector('.live-photo-mute-btn');
    if (!video || !muteBtn) return;
    
    var isCurrentlyMuted = muteBtn.dataset.muted === 'true';
    var newMuted = !isCurrentlyMuted;
    
    muteBtn.dataset.muted = newMuted ? 'true' : 'false';
    video.muted = newMuted;
    
    // 更新样式
    if (newMuted) {
        container.classList.add('is-muted');
        container.classList.remove('not-muted');
    } else {
        container.classList.remove('is-muted');
        container.classList.add('not-muted');
    }
}

// 导出到全局
window.initLivePhotoComponents = initLivePhotoComponents;

// DOM 加载完成后初始化所有 live-photo
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(function() {
        initLivePhotoComponents(document);
    }, 50);
});

// PJAX 支持
document.addEventListener('pjax:complete', function() {
    setTimeout(function() {
        initLivePhotoComponents(document);
    }, 50);
});
