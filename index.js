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
    gameList: [] // 등록된 게임 파일명 목록
};

let settings = {};
let rufflePlayer = null; // Ruffle 인스턴스

// Ruffle 스크립트 로드
async function loadRuffleEngine() {
    if (window.RufflePlayer) return; // 이미 로드됨

    window.RufflePlayer = {};
    const script = document.createElement("script");
    script.src = `${extensionFolderPath}/ruffle/ruffle.js`;
    script.onload = () => {
        console.log('[FlashGamePopup] Ruffle engine loaded.');
    };
    document.head.appendChild(script);
}

// 팝업 생성 함수
function createFlashPopup(swfUrlOrData) {
    // 이미 팝업이 있으면 닫고 새로 생성
    $('#flash-game-popup-container').remove();

    const popupHtml = `
        <div id="flash-game-popup-container" style="top: ${settings.pos.top}px; left: ${settings.pos.left}px; width: ${settings.width}px; height: ${settings.height}px;">
            <div id="fgp-header">
                <div id="fgp-title">🎮 Flash Game Player</div>
                <div id="fgp-controls">
                    <div class="fgp-volume-control">
                        <i class="fa-solid fa-volume-high"></i>
                        <input type="range" id="fgp-volume-slider" min="0" max="1" step="0.05" value="${settings.volume}">
                    </div>
                    <button id="fgp-close-btn" title="닫기"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </div>
            <div id="fgp-content">
                <div id="ruffle-container"></div>
            </div>
            <div id="fgp-resize-handle"></div>
        </div>
    `;
    $('body').append(popupHtml);

    const $container = $('#flash-game-popup-container');
    
    // 이벤트 바인딩
    $('#fgp-close-btn').on('click', () => {
        $container.remove();
        rufflePlayer = null;
    });

    $('#fgp-volume-slider').on('input', function() {
        const val = parseFloat($(this).val());
        settings.volume = val;
        saveSettingsDebounced();
        if (rufflePlayer) {
            rufflePlayer.volume = val; // Ruffle 볼륨 API
        }
    });

    // 드래그 및 리사이즈 기능 연결
    bindDragFunctionality($container);
    
    // Ruffle 플레이어 생성 및 실행
    if (window.RufflePlayer && window.RufflePlayer.newest) {
        const ruffle = window.RufflePlayer.newest();
        rufflePlayer = ruffle.createPlayer();
        const container = document.getElementById("ruffle-container");
        container.appendChild(rufflePlayer);
        
        // 설정된 볼륨 적용
        rufflePlayer.volume = settings.volume;

        // 게임 로드
        rufflePlayer.load(swfUrlOrData).then(() => {
            console.log("SWF Loaded successfully");
        }).catch((e) => {
            console.error("SWF Load failed:", e);
        });
    } else {
        alert('Ruffle 엔진이 아직 로드되지 않았습니다. 잠시 후 다시 시도해주세요.');
    }
}

// 드래그 기능 (Popupmemo 참고)
function bindDragFunctionality($element) {
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;
    const container = $element[0];
    const header = $element.find('#fgp-header')[0];

    // 헤더 드래그
    $(header).on('mousedown', (e) => {
        if ($(e.target).is('input') || $(e.target).closest('button').length) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        initialLeft = container.offsetLeft;
        initialTop = container.offsetTop;
        $element.addClass('dragging');
    });

    $(document).on('mousemove', (e) => {
        if (!isDragging) return;
        let deltaX = e.clientX - startX;
        let deltaY = e.clientY - startY;
        
        let newLeft = initialLeft + deltaX;
        let newTop = initialTop + deltaY;
        
        container.style.left = `${newLeft}px`;
        container.style.top = `${newTop}px`;
        
        settings.pos.left = newLeft;
        settings.pos.top = newTop;
    });

    $(document).on('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            $element.removeClass('dragging');
            saveSettingsDebounced();
        }
    });

    // 리사이즈 옵저버 (크기 저장용)
    const resizeObserver = new ResizeObserver(() => {
        settings.width = $element.width();
        settings.height = $element.height();
        saveSettingsDebounced();
    });
    resizeObserver.observe(container);
}

// 설정창 UI 로드 및 이벤트
function loadSettingsToUI() {
    // 드롭다운 갱신
    const $select = $('#fgp_game_dropdown');
    $select.empty();
    
    if (settings.gameList.length === 0) {
        $select.append('<option value="" disabled selected>등록된 게임이 없습니다.</option>');
    } else {
        settings.gameList.forEach(game => {
            $select.append(`<option value="${game}">${game}</option>`);
        });
    }

    // 목록 관리 리스트 렌더링
    renderGameList();
}

function renderGameList() {
    const $list = $('#fgp_manage_list');
    $list.empty();
    
    settings.gameList.forEach((game, index) => {
        const item = `
            <div class="fgp-list-item">
                <span>${game}</span>
                <button class="fgp-delete-btn menu_button red_button" data-index="${index}">삭제</button>
            </div>
        `;
        $list.append(item);
    });

    $('.fgp-delete-btn').on('click', function() {
        const idx = $(this).data('index');
        settings.gameList.splice(idx, 1);
        saveSettingsDebounced();
        loadSettingsToUI();
    });
}

// 초기화
(async function() {
    // 설정 로드
    settings = extension_settings[extensionName] = extension_settings[extensionName] || DEFAULT_SETTINGS;
    if (!settings.gameList) settings.gameList = [];
    if (!settings.pos) settings.pos = DEFAULT_SETTINGS.pos;

    // Ruffle 로드
    await loadRuffleEngine();

    // 설정 HTML 주입
    try {
        const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
        $("#extensions_settings2").append(settingsHtml);
        
        // 이벤트 리스너: 로컬 파일 즉시 실행
        $('#fgp_local_file_input').on('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                const fileUrl = URL.createObjectURL(file);
                createFlashPopup(fileUrl);
            }
        });

        // 이벤트 리스너: 게임 목록에 추가
        $('#fgp_add_game_btn').on('click', () => {
            const fileName = $('#fgp_filename_input').val().trim();
            if (fileName && !settings.gameList.includes(fileName)) {
                if(!fileName.endsWith('.swf')) {
                    alert('.swf 확장자까지 정확히 입력해주세요.');
                    return;
                }
                settings.gameList.push(fileName);
                saveSettingsDebounced();
                loadSettingsToUI();
                $('#fgp_filename_input').val('');
            }
        });

        // 이벤트 리스너: 드롭다운 선택 실행
        $('#fgp_play_selected_btn').on('click', () => {
            const selectedGame = $('#fgp_game_dropdown').val();
            if (selectedGame) {
                // Extension 내부 경로로 실행
                const gamePath = `${extensionFolderPath}/games/${selectedGame}`;
                createFlashPopup(gamePath);
            } else {
                alert('목록에서 게임을 선택해주세요.');
            }
        });

        loadSettingsToUI();

    } catch (e) {
        console.error(`[${extensionName}] Error loading settings:`, e);
    }
})();