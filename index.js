/* --- START OF FILE index.js --- */

import {
    saveSettingsDebounced,
    eventSource,
    event_types
} from '../../../../script.js';

import {
    extension_settings
} from '../../../extensions.js';

const extensionName = 'FlashGamePopup';
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// 기본 설정
const DEFAULT_SETTINGS = {
    volume: 0.5,
    pos: { top: 100, left: 100 },
    width: 600,
    height: 450,
    categories: ["전체", "기본"], // 카테고리 목록
    gameList: [] // { name, file, category }
};

let settings = {};
let rufflePlayer = null;
let selectedGameIndex = -1; // 현재 필터링된 리스트 기준 인덱스
let isEditMode = false;
let currentCategory = "전체"; // 현재 보고 있는 탭
let currentZoom = 1.0; // 줌 레벨 상태

// Ruffle 스크립트 로드
async function loadRuffleEngine() {
    if (window.RufflePlayer) return;
    window.RufflePlayer = {};
    const script = document.createElement("script");
    script.src = `${extensionFolderPath}/ruffle/ruffle.js`;
    script.onload = () => { console.log('[FlashGamePopup] Ruffle engine loaded.'); };
    document.head.appendChild(script);
}

// 팝업 생성 함수
function createFlashPopup(swfUrlOrData, title = "Flash Game Player") {
    $('#flash-game-popup-container').remove();
    currentZoom = 1.0; // 팝업 열 때 줌 초기화
    let isPaused = false; // 현재 일시정지 상태 추적

    const popupHtml = `
        <div id="flash-game-popup-container" style="top: ${settings.pos.top}px; left: ${settings.pos.left}px; width: ${settings.width}px; height: ${settings.height}px;">
            <div id="fgp-header">
                <div id="fgp-title"><i class="fa-solid fa-gamepad"></i> ${title}</div>
                <div id="fgp-controls">
                    <!-- 정지/재생 버튼 (새로 추가됨) -->
                    <button class="fgp-ctrl-btn" id="fgp-pause-btn" title="일시정지/재생" style="margin-right: 8px;">
                        <i class="fa-solid fa-pause"></i>
                    </button>

                    <!-- 확대/축소 컨트롤 -->
                    <div class="fgp-zoom-control">
                        <i class="fa-solid fa-magnifying-glass" style="font-size:0.8em; color:#aaa; margin-right:3px;"></i>
                        <button class="fgp-zoom-btn" id="fgp-zoom-minus">-</button>
                        <span id="fgp-zoom-val">100%</span>
                        <button class="fgp-zoom-btn" id="fgp-zoom-plus">+</button>
                    </div>

                    <div class="fgp-volume-control">
                        <i class="fa-solid fa-volume-high"></i>
                        <input type="range" id="fgp-volume-slider" min="0" max="1" step="0.05" value="${settings.volume}">
                    </div>
                    <button class="fgp-ctrl-btn" id="fgp-minimize-btn" title="최소화(접기)/복원"><i class="fa-regular fa-window-minimize"></i></button>
                    <button class="fgp-ctrl-btn close" id="fgp-close-btn" title="닫기"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </div>
            <div id="fgp-content"><div id="ruffle-container"></div></div>
            <div id="fgp-resize-handle"></div>
        </div>
    `;
    $('body').append(popupHtml);

    const $container = $('#flash-game-popup-container');
    const $zoomVal = $('#fgp-zoom-val');
    const $ruffleContainer = $('#ruffle-container');
    const $pauseBtn = $('#fgp-pause-btn');
    const $minimizeBtn = $('#fgp-minimize-btn');
    
    // 우클릭 방지 (게임 내 우클릭 메뉴 허용)
    $container.on('contextmenu', function(e) {
        e.preventDefault();
        e.stopPropagation();
        return false;
    });

    $('#fgp-close-btn').on('click', () => { 
        $container.remove(); 
        rufflePlayer = null; 
    });

    // --- 일시정지/재생 제어 함수 ---
    function togglePause(forceState = null) {
        if (!rufflePlayer) return;

        // forceState가 있으면 그 상태로 강제, 없으면 토글
        const nextState = (forceState !== null) ? forceState : !isPaused;
        
        if (nextState) {
            // 정지 실행
            rufflePlayer.pause(); 
            $container.addClass('paused');
            $pauseBtn.find('i').attr('class', 'fa-solid fa-play'); // 아이콘을 플레이로 변경
            $pauseBtn.css('color', '#ff8a80'); // 버튼 색상 강조
            isPaused = true;
        } else {
            // 재생 실행
            rufflePlayer.play();
            $container.removeClass('paused');
            $pauseBtn.find('i').attr('class', 'fa-solid fa-pause'); // 아이콘을 일시정지로 변경
            $pauseBtn.css('color', ''); // 버튼 색상 복구
            isPaused = false;
        }
    }

    // 정지 버튼 클릭 이벤트
    $pauseBtn.on('click', function() {
        togglePause();
    });

    // 최소화/복원 버튼 클릭 이벤트 (자동 정지 기능 포함)
    $minimizeBtn.on('click', function() {
        const willMinimize = !$container.hasClass('minimized');
        $container.toggleClass('minimized');
        
        if (willMinimize) {
            // 최소화 시: 아이콘 변경 및 자동 정지
            $(this).find('i').attr('class', 'fa-regular fa-window-maximize');
            
            // 아직 정지 상태가 아니라면 정지시킴 (원래 정지였으면 그대로 둠)
            if (!isPaused) {
                togglePause(true);
                // 최소화 때문에 자동 정지된 것임을 표시해두려면 별도 플래그가 필요할 수 있으나,
                // 여기서는 "최소화=무조건 정지" 로직으로 처리합니다.
            }
        } else {
            // 복원 시: 아이콘 변경 및 자동 재생
            $(this).find('i').attr('class', 'fa-regular fa-window-minimize');
            
            // 복원하면 게임을 다시 재생
            togglePause(false);
        }
    });

    // 팝업 내 볼륨 슬라이더
    $('#fgp-volume-slider').on('input', function() {
        const val = parseFloat($(this).val());
        settings.volume = val;
        saveSettingsDebounced();
        
        // 팝업 내 플레이어 적용
        if (rufflePlayer) rufflePlayer.volume = val;
        
        // 설정창의 슬라이더도 동기화
        $('#fgp_default_volume').val(val);
    });

    // 줌 기능 구현
    function updateZoom() {
        // 소수점 1자리까지 표시
        $zoomVal.text(`${Math.round(currentZoom * 100)}%`);
        // ruffle-player 태그 자체에 스케일 적용 (transform-origin은 중앙)
        $('ruffle-player').css({
            'transform': `scale(${currentZoom})`,
            'transform-origin': 'center center'
        });
    }

    $('#fgp-zoom-plus').on('click', () => {
        currentZoom += 0.1;
        updateZoom();
    });
    $('#fgp-zoom-minus').on('click', () => {
        if (currentZoom > 0.2) currentZoom -= 0.1;
        updateZoom();
    });

    bindDragFunctionality($container);
    
    if (window.RufflePlayer && window.RufflePlayer.newest) {
        const ruffle = window.RufflePlayer.newest();
        rufflePlayer = ruffle.createPlayer();
        
        // Ruffle 설정 (세이브 데이터 보존을 위한 설정 포함)
        rufflePlayer.config = { 
            "allowScriptAccess": true, 
            "autoplay": "on", 
            "unmuteOverlay": "hidden", 
            "menu": true, 
            "backgroundColor": "#000000",
            "letterbox": "on", // 컨테이너 비율에 맞춰 게임 화면 조정
            "upgradeToHttps": false, // 로컬 환경 호환성
        };
        
        $ruffleContainer.append(rufflePlayer);
        
        // [추가됨] Ruffle 화면(오버레이 재생 버튼)을 직접 눌러 실행 시, 상단 UI 동기화
        $(rufflePlayer).on('click', () => {
            if (isPaused) {
                // 사용자가 게임 화면을 클릭하여 재개했다면, 상단 버튼도 '정지' 모양(현재 재생중)으로 변경
                // togglePause(false)는 '강제로 재생 상태로 설정'하는 역할을 함
                togglePause(false);
            }
        });
        
        // [중요] 게임 로드 및 볼륨 즉시 적용
        rufflePlayer.load(swfUrlOrData).then(() => {
            console.log("SWF Loaded");
            // 로드 완료 후 볼륨 강제 재적용 (초기화 문제 해결)
            setTimeout(() => {
                if (rufflePlayer) {
                    rufflePlayer.volume = settings.volume; 
                    rufflePlayer.focus();
                }
            }, 200);
        }).catch(e => {
            console.error(e);
            $('#ruffle-container').html(`<div style="color:white;text-align:center;padding-top:20px;">로드 실패<br>${e}</div>`);
        });

        // 로드 시작 시점에도 볼륨 설정 시도
        rufflePlayer.volume = settings.volume;

    } else {
        alert('Ruffle 엔진 로딩중...');
    }
}

function bindDragFunctionality($element) {
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;
    const container = $element[0];
    
    $element.find('#fgp-header').on('mousedown', (e) => {
        if ($(e.target).is('input') || $(e.target).closest('button').length || $(e.target).closest('.fgp-zoom-control').length) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        initialLeft = container.offsetLeft;
        initialTop = container.offsetTop;
        $element.addClass('dragging');
    });

    $(document).on('mousemove', (e) => {
        if (!isDragging) return;
        container.style.left = `${initialLeft + (e.clientX - startX)}px`;
        container.style.top = `${initialTop + (e.clientY - startY)}px`;
        settings.pos.left = parseFloat(container.style.left);
        settings.pos.top = parseFloat(container.style.top);
    });

    $(document).on('mouseup', () => {
        if (isDragging) { isDragging = false; $element.removeClass('dragging'); saveSettingsDebounced(); }
    });
    
    new ResizeObserver(() => {
        if (!$element.hasClass('minimized')) {
            settings.width = $element.width();
            settings.height = $element.height();
            saveSettingsDebounced();
        }
    }).observe(container);
}

// --- 데이터 관리 기능 ---

function getFilteredGames() {
    if (currentCategory === "전체") return settings.gameList;
    return settings.gameList.filter(g => (g.category || "기본") === currentCategory);
}

function updateGameItem(originalIndex, key, value) {
    if (settings.gameList[originalIndex]) {
        settings.gameList[originalIndex][key] = value;
        saveSettingsDebounced();
        if (key === 'category') renderGameList(); 
    }
}

function renderTabs() {
    const $container = $('#fgp_tabs_container');
    $container.empty();

    settings.categories.forEach(cat => {
        const isActive = cat === currentCategory;
        const $btn = $(`<button class="fgp-tab-btn ${isActive ? 'active' : ''}">${cat}</button>`);
        
        $btn.on('click', () => {
            if (currentCategory !== cat) {
                currentCategory = cat;
                selectedGameIndex = -1;
                renderTabs();
                renderGameList();
            } else if (isEditMode && cat !== "전체") {
                openCategoryModal(cat);
            }
        });
        $container.append($btn);
    });

    if (isEditMode) {
        const $addBtn = $(`<button class="fgp-add-tab-btn" title="새 폴더(카테고리) 추가"><i class="fa-solid fa-plus"></i></button>`);
        $addBtn.on('click', () => openCategoryModal(null));
        $container.append($addBtn);
    }
}

function renderGameList() {
    const $container = $('#fgp_game_list_container');
    $container.empty();
    
    if ($container.sortable("instance")) {
        $container.sortable("destroy");
    }

    const $editBtn = $('#fgp_edit_mode_btn');
    if (isEditMode) {
        $editBtn.html('<i class="fa-solid fa-check"></i> 완료').addClass('active-pastel');
        $container.addClass('edit-active');
    } else {
        $editBtn.html('<i class="fa-solid fa-pen-to-square"></i> 편집').removeClass('active-pastel');
        $container.removeClass('edit-active');
    }

    renderTabs();

    const filteredList = getFilteredGames();

    if (filteredList.length === 0) {
        $container.append('<div class="fgp-empty-msg">이 폴더에는 게임이 없습니다.<br>추가 버튼을 누르거나 편집 모드에서 게임을 이동시키세요.</div>');
        return;
    }

    filteredList.forEach((game, idx) => {
        const realIndex = settings.gameList.indexOf(game);
        const isSelected = idx === selectedGameIndex;
        const readonlyAttr = isEditMode ? '' : 'readonly';

        let categorySelectHtml = '';
        if (isEditMode) {
            const options = settings.categories.filter(c => c !== "전체").map(c => 
                `<option value="${c}" ${c === (game.category || "기본") ? 'selected' : ''}>${c}</option>`
            ).join('');
            categorySelectHtml = `<select class="fgp-category-select" data-real-index="${realIndex}">${options}</select>`;
        }

        const itemHtml = `
            <div class="fgp-game-item ${isSelected ? 'selected' : ''}" data-list-index="${idx}" data-real-index="${realIndex}">
                ${isEditMode ? '<i class="fa-solid fa-grip-lines sort-handle" style="color:#ddd; cursor:grab; padding:0 5px;"></i>' : ''}
                <div class="fgp-game-info-area">
                    <div class="fgp-input-row" style="display:flex; justify-content:space-between;">
                        <input type="text" class="fgp-clean-input name" value="${game.name}" ${readonlyAttr}>
                        ${categorySelectHtml}
                    </div>
                    <div class="fgp-input-row">
                        <input type="text" class="fgp-clean-input file" value="${game.file}" ${readonlyAttr}>
                    </div>
                </div>
                <div class="fgp-item-actions">
                     <button class="fgp-icon-btn delete" title="삭제"><i class="fa-solid fa-trash-can"></i></button>
                </div>
            </div>
        `;
        $container.append(itemHtml);
    });

    if (isEditMode) {
        $container.sortable({
            handle: '.sort-handle',
            axis: 'y',
            placeholder: 'fgp-sort-placeholder',
            update: function(event, ui) {
                const newOrderIndices = [];
                $container.find('.fgp-game-item').each(function() {
                    newOrderIndices.push($(this).data('real-index'));
                });

                const itemsToSort = newOrderIndices.map(idx => settings.gameList[idx]);
                const itemsToKeep = settings.gameList.filter((_, idx) => !newOrderIndices.includes(idx));
                
                if (currentCategory === "전체") {
                     settings.gameList = itemsToSort;
                } else {
                    settings.gameList = [...itemsToKeep, ...itemsToSort];
                }

                saveSettingsDebounced();
                renderGameList();
            }
        });
    }

    $('.fgp-game-item').on('click', function(e) {
        if ($(e.target).is('input') || $(e.target).is('select') || $(e.target).closest('button').length) return;
        selectedGameIndex = $(this).data('list-index');
        $('.fgp-game-item').removeClass('selected');
        $(this).addClass('selected');
    });

    $('.fgp-icon-btn.delete').on('click', function(e) {
        e.stopPropagation();
        const realIdx = $(this).closest('.fgp-game-item').data('real-index');
        if (confirm('정말 삭제하시겠습니까?')) {
            settings.gameList.splice(realIdx, 1);
            saveSettingsDebounced();
            selectedGameIndex = -1;
            renderGameList();
        }
    });

    if (isEditMode) {
        $('.fgp-clean-input.name').on('change', function() {
            updateGameItem($(this).closest('.fgp-game-item').data('real-index'), 'name', $(this).val());
        });
        $('.fgp-clean-input.file').on('change', function() {
            updateGameItem($(this).closest('.fgp-game-item').data('real-index'), 'file', $(this).val());
        });
        $('.fgp-category-select').on('change', function() {
            const realIdx = $(this).data('real-index');
            const newCat = $(this).val();
            updateGameItem(realIdx, 'category', newCat);
            renderGameList();
        });
    }
}

function openCategoryModal(categoryName) {
    const $modal = $('#fgp_category_modal');
    const $input = $('#fgp_input_cat_name');
    const $delBtn = $('#fgp_cat_modal_delete');
    
    $input.val(categoryName || '');
    $modal.removeClass('fgp-hidden');
    
    if (categoryName && categoryName !== "기본" && categoryName !== "전체") {
        $delBtn.show().off('click').on('click', () => {
            if (confirm(`'${categoryName}' 폴더를 삭제하시겠습니까?\n내부 게임은 '기본' 폴더로 이동됩니다.`)) {
                settings.gameList.forEach(g => { if(g.category === categoryName) g.category = "기본"; });
                settings.categories = settings.categories.filter(c => c !== categoryName);
                currentCategory = "전체";
                saveSettingsDebounced();
                renderTabs();
                renderGameList();
                $modal.addClass('fgp-hidden');
            }
        });
    } else {
        $delBtn.hide();
    }

    $('#fgp_cat_modal_save').off('click').on('click', () => {
        const newName = $input.val().trim();
        if (!newName) return toastr.warning('이름을 입력하세요.');
        if (settings.categories.includes(newName) && newName !== categoryName) return toastr.warning('이미 존재하는 이름입니다.');

        if (categoryName) {
            const idx = settings.categories.indexOf(categoryName);
            settings.categories[idx] = newName;
            settings.gameList.forEach(g => { if(g.category === categoryName) g.category = newName; });
            if (currentCategory === categoryName) currentCategory = newName;
        } else {
            settings.categories.push(newName);
        }
        
        saveSettingsDebounced();
        renderTabs();
        renderGameList();
        $modal.addClass('fgp-hidden');
    });

    $('#fgp_cat_modal_cancel').off('click').on('click', () => $modal.addClass('fgp-hidden'));
}

async function fetchGameListFromFile() {
    try {
        const response = await fetch(`${extensionFolderPath}/games/list.txt?t=${Date.now()}`);
        if (!response.ok) throw new Error("list.txt 없음");
        
        const text = await response.text();
        const lines = text.split(/\r?\n/).filter(line => line.trim() !== "");
        let addedCount = 0;

        lines.forEach(line => {
            const trimmedLine = line.trim();
            // 주석(#, //)으로 시작하거나 빈 줄은 건너뜀
            if (trimmedLine.startsWith('#') || trimmedLine.startsWith('//') || trimmedLine === "") return;

            // "파일명/표시명" 형식 파싱
            const parts = trimmedLine.split('/');
            let fileName = parts[0].trim();
            let displayName = parts.length > 1 ? parts[1].trim() : "";

            // 확장자가 없으면 자동으로 .swf 추가
            if (!fileName.toLowerCase().endsWith('.swf')) fileName += '.swf';
            
            // 표시명이 비어있다면 파일명(확장자 제거)을 이름으로 사용
            if (!displayName) displayName = fileName.replace(/\.swf$/i, '');

            const exists = settings.gameList.some(g => g.file === fileName);
            
            if (!exists) {
                settings.gameList.push({
                    file: fileName,
                    name: displayName,
                    category: "기본"
                });
                addedCount++;
            }
        });
        
if (addedCount > 0) {
            toastr.success(`${addedCount}개의 게임을 리스트에서 불러와 추가했습니다.`);
            saveSettingsDebounced();
            renderGameList();
        } else {
            toastr.info('리스트 파일에서 새로운 게임을 찾지 못했습니다.');
        }
    } catch (e) {
        console.warn(e);
        toastr.error('games/list.txt 파일을 찾을 수 없습니다.');
    }
}

// 목록 내보내기 (list.txt 생성)
function exportGameListToFile() {
    const header = `# --- FlashGamePopup 게임 목록 설정 파일 ---
# 이 파일에 게임 파일명과 표시할 이름을 적으면 "새로고침" 시 자동으로 추가됩니다.
#
# [작성 방법]
# 파일명 / 표시할이름
#
# [예시]
# super_mario.swf / 슈퍼 마리오
# sonic / 소닉 (확장자 .swf는 생략 가능)
#
# 아래에 게임을 추가하세요.
# ----------------------------------------
`;
    
    // 현재 리스트를 "파일명 / 이름" 형식으로 변환
    const listContent = settings.gameList.map(game => {
        let line = game.file;
        // 표시 이름이 파일명(확장자 제외)과 다르면 이름도 병기
        const simpleName = game.file.replace(/\.swf$/i, '');
        if (game.name && game.name !== simpleName) {
            line += ` / ${game.name}`;
        }
        return line;
    }).join('\n');

    const fileContent = header + '\n' + listContent;
    const blob = new Blob([fileContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = "list.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// 컨텍스트 메뉴(#context-menu)가 화면 밖으로 나가는 문제 수정
function fixContextMenuPosition() {
    $(document).on('contextmenu', function(e) {
        // 메뉴가 렌더링될 시간을 아주 잠깐 줌
        setTimeout(() => {
            const $menu = $('#context-menu');
            if ($menu.length && $menu.is(':visible')) {
                const winW = $(window).width();
                const winH = $(window).height();
                const menuW = $menu.outerWidth();
                const menuH = $menu.outerHeight();
                
                // 현재 위치 파싱 (px 제거)
                let currLeft = parseInt($menu.css('left')) || e.clientX;
                let currTop = parseInt($menu.css('top')) || e.clientY;

                // 오른쪽 경계 확인 -> 왼쪽으로 이동
                if (currLeft + menuW > winW) {
                    $menu.css('left', (winW - menuW - 10) + 'px');
                }

                // 아래쪽 경계 확인 -> 위쪽으로 이동
                if (currTop + menuH > winH) {
                    $menu.css('top', (winH - menuH - 10) + 'px');
                }
            }
        }, 10); // ST 기본 동작 후 실행되도록 지연
    });
}

(async function() {
    settings = extension_settings[extensionName] = extension_settings[extensionName] || DEFAULT_SETTINGS;
    if (!settings.categories) settings.categories = ["전체", "기본"];
    if (!Array.isArray(settings.gameList)) settings.gameList = [];
    
    settings.gameList.forEach(g => { if(!g.category) g.category = "기본"; });

    await loadRuffleEngine();

    try {
        const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
        $("#extensions_settings2").append(settingsHtml);
        
        renderTabs();
        renderGameList();

        const $addModal = $('#fgp_add_modal');
        const $filenameInput = $('#fgp_input_filename');
        const $displaynameInput = $('#fgp_input_displayname');

        $('#fgp_open_add_modal_btn').on('click', () => {
            $filenameInput.val('');
            $displaynameInput.val('');
            $addModal.removeClass('fgp-hidden');
            $filenameInput.focus();
        });

        $('#fgp_modal_cancel').on('click', () => {
            $addModal.addClass('fgp-hidden');
        });

        $('#fgp_modal_save').on('click', () => {
            let file = $filenameInput.val().trim();
            let name = $displaynameInput.val().trim();
            
            if (!file) {
                toastr.warning('파일명을 입력해주세요.');
                return;
            }
            if (!file.toLowerCase().endsWith('.swf')) file += '.swf';
            if (!name) name = file.replace('.swf', '');

            const targetCat = (currentCategory === "전체") ? "기본" : currentCategory;

            settings.gameList.push({ file: file, name: name, category: targetCat });
            saveSettingsDebounced();
            renderGameList();
            $addModal.addClass('fgp-hidden');
        });

$('#fgp_edit_mode_btn').on('click', () => {
            isEditMode = !isEditMode;
            renderGameList();
        });

        $('#fgp_refresh_list_btn').on('click', () => fetchGameListFromFile());
        
        // [추가됨] 내보내기 버튼 연결
        $('#fgp_export_list_btn').on('click', () => exportGameListToFile());

        // [추가됨] 컨텍스트 메뉴 위치 보정 활성화
        fixContextMenuPosition();

        $('#fgp_play_selected_btn').on('click', () => {
            const filtered = getFilteredGames();
            if (selectedGameIndex >= 0 && filtered[selectedGameIndex]) {
                const game = filtered[selectedGameIndex];
                const gamePath = `${extensionFolderPath}/games/${game.file}`;
                createFlashPopup(gamePath, game.name);
            } else {
                toastr.info('실행할 게임을 선택해주세요.');
            }
        });

        // 5. 볼륨 설정창 - 팝업 동기화 및 저장
        $('#fgp_default_volume').val(settings.volume).on('input', function() {
            const val = parseFloat($(this).val());
            settings.volume = val;
            
            // 현재 열려있는 팝업이 있다면 즉시 적용
            if (rufflePlayer) {
                rufflePlayer.volume = val;
                $('#fgp-volume-slider').val(val); // 팝업 내 슬라이더도 이동
            }
            
            saveSettingsDebounced();
        });

    } catch (e) {
        console.error(`[${extensionName}] Error loading settings:`, e);
    }
})();