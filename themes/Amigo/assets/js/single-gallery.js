/**
 * 文章详情页 gallery 处理
 * 扫描正文中的图片和 live-photo，统一展示到 gallery 中
 */

function initSingleGallery() {
    var gallery = document.getElementById('article-gallery');
    var articleText = document.querySelector('.single-view .article-text');
    if (!gallery || !articleText) return;
    
    // 收集所有图片和 live-photo
    var items = [];
    
    // 1. 收集 live-photo 元素
    var livePhotos = articleText.querySelectorAll('.live-photo');
    livePhotos.forEach(function(el) {
        var video = el.dataset.video || '';
        var poster = el.querySelector('.live-photo-poster');
        var src = poster ? poster.src : '';
        
        // 从正文中移除
        el.remove();
        
        items.push({
            type: 'live-photo',
            src: src,
            video: video,
            element: el
        });
    });
    
    // 2. 收集普通 img 标签
    var imgs = articleText.querySelectorAll('img');
    imgs.forEach(function(img) {
        // 跳过已经被移除的
        if (!img.parentNode) return;
        
        var src = img.src;
        if (src) {
            img.remove();
            items.push({
                type: 'image',
                src: src,
                alt: img.alt || '',
                element: img
            });
        }
    });
    
    // 如果没有图片，隐藏 gallery
    if (items.length === 0) {
        gallery.style.display = 'none';
        return;
    }
    
    // 根据数量决定布局
    var len = items.length;
    gallery.innerHTML = '';
    
    if (len === 1) {
        // 单张图片 - 居中展示
        var singleWrap = document.createElement('div');
        singleWrap.className = 'gallery-single';
        singleWrap.appendChild(createGalleryItem(items[0], true));
        gallery.appendChild(singleWrap);
    } else {
        // 多张图片 - 网格布局
        var colsClass = (len === 2 || len === 4) ? 'cols-2' : 'cols-3';
        var grid = document.createElement('div');
        grid.className = 'gallery-grid ' + colsClass;
        
        items.forEach(function(item) {
            grid.appendChild(createGalleryItem(item, false));
        });
        
        gallery.appendChild(grid);
    }
    
    // 重新初始化 live-photo 组件
    if (window.initLivePhotoComponents) {
        // 先标记旧元素为未初始化
        gallery.querySelectorAll('.live-photo').forEach(function(el) {
            delete el.dataset.liveInit;
        });
        initLivePhotoComponents(gallery);
    }
}

function createGalleryItem(item, isSingle) {
    var wrap = document.createElement('div');
    
    if (item.type === 'live-photo') {
        wrap.className = 'gallery-item is-live';
        if (isSingle) {
            // 单张实况图直接使用原始元素
            wrap.appendChild(item.element);
        } else {
            // 多张时克隆元素并调整样式
            var clone = item.element.cloneNode(true);
            clone.style.margin = '0';
            clone.style.maxWidth = '100%';
            clone.style.width = '100%';
            clone.style.borderRadius = '8px';
            clone.style.aspectRatio = '3/4';
            wrap.appendChild(clone);
        }
    } else {
        wrap.className = 'gallery-item';
        var img = item.element;
        if (!img) {
            img = document.createElement('img');
            img.src = item.src;
            img.alt = item.alt || '';
            img.loading = 'lazy';
        }
        wrap.appendChild(img);
    }
    
    return wrap;
}

// DOM 加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(initSingleGallery, 100); // 延迟执行，确保 shortcode 渲染完成
});

// PJAX 支持
document.addEventListener('pjax:complete', function() {
    setTimeout(initSingleGallery, 100);
});
