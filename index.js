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
    gameList: [] // 이제 { file: "name.swf", name: "Display Name" } 형태의 객체를 저장
};

let settings = {};
let rufflePlayer = null;
let selectedGameIndex = -1; // 현재 설정창에서 선택된 게임 인덱스

// Ruffle 스크립트 로드
async function loadRuffleEngine() {
    if (window.RufflePlayer) return;

    window.RufflePlayer = {};
    const script = document.createElement("script");
    script.src = `${extensionFolderPath}/ruffle/ruffle.js`;
    script.onload = () => {
        console.log('[FlashGamePopup] Ruffle engine loaded.');
    };
    document.head.appendChild(script);
}

// 팝업 생성 함수
function createFlashPopup(swfUrlOrData, title = "Flash Game Player") {
    $('#flash-game-popup-container').remove();

    const popupHtml = `
        <div id="flash-game-popup-container" style="top: ${settings.pos.top}px; left: ${settings.pos.left}px; width: ${settings.width}px; height: ${settings.height}px;">
            <div id="fgp-header">
                <div id="fgp-title"><i class="fa-solid fa-gamepad"></i> ${title}</div>
                <div id="fgp-controls">
                    <div class="fgp-volume-control">
                        <i class="fa-solid fa-volume-high"></i>
                        <input type="range" id="fgp-volume-slider" min="0" max="1" step="0.05" value="${settings.volume}">
                    </div>
                    <button class="fgp-ctrl-btn" id="fgp-minimize-btn" title="최소화/복원"><i class="fa-regular fa-window-minimize"></i></button>
                    <button class="fgp-ctrl-btn close" id="fgp-close-btn" title="닫기"><i class="fa-solid fa-xmark"></i></button>
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

    // 최소화 토글
    $('#fgp-minimize-btn').on('click', function() {
        $container.toggleClass('minimized');
        const icon = $container.hasClass('minimized') ? 'fa-window-maximize' : 'fa-window-minimize';
        $(this).find('i').attr('class', `fa-regular ${icon}`);
    });

    $('#fgp-volume-slider').on('input', function() {
        const val = parseFloat($(this).val());
        settings.volume = val;
        saveSettingsDebounced();
        if (rufflePlayer) rufflePlayer.volume = val;
    });

    bindDragFunctionality($container);
    
    // Ruffle 실행
    if (window.RufflePlayer && window.RufflePlayer.newest) {
        const ruffle = window.RufflePlayer.newest();
        rufflePlayer = ruffle.createPlayer();
        const container = document.getElementById("ruffle-container");
        container.appendChild(rufflePlayer);
        
        rufflePlayer.volume = settings.volume;

        rufflePlayer.load(swfUrlOrData).then(() => {
            console.log("SWF Loaded successfully");
        }).catch((e) => {
            console.error("SWF Load failed:", e);
        });
    } else {
        alert('Ruffle 엔진이 로드 중입니다. 잠시 후 다시 시도해주세요.');
    }
}

function bindDragFunctionality($element) {
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;
    const container = $element[0];
    const header = $element.find('#fgp-header')[0];

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
        
        // 최소화 상태가 아닐 때만 위치 업데이트 (혹은 최소화 상태에서도 이동 가능하게 하려면 유지)
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

    const resizeObserver = new ResizeObserver(() => {
        if (!$element.hasClass('minimized')) {
            settings.width = $element.width();
            settings.height = $element.height();
            saveSettingsDebounced();
        }
    });
    resizeObserver.observe(container);
}

// 데이터 마이그레이션 (구버전 문자열 배열 -> 신버전 객체 배열)
function migrateGameList() {
    if (!Array.isArray(settings.gameList)) {
        settings.gameList = [];
        return;
    }
    // 문자열인 요소가 하나라도 있으면 변환
    const needsMigration = settings.gameList.some(item => typeof item === 'string');
    if (needsMigration) {
        settings.gameList = settings.gameList.map(item => {
            if (typeof item === 'string') {
                return { file: item, name: item }; // 이름은 파일명으로 초기화
            }
            return item;
        });
        saveSettingsDebounced();
    }
}

// UI: 게임 리스트 렌더링
function renderGameList() {
    const $container = $('#fgp_game_list_container');
    $container.empty();
    
    if (settings.gameList.length === 0) {
        $container.append('<div style="padding:20px; text-align:center; color:#666;">등록된 게임이 없습니다.<br>추가 버튼을 눌러보세요.</div>');
        $('#fgp_play_selected_btn').prop('disabled', true).text('선택한 게임 실행');
        return;
    }

    settings.gameList.forEach((game, index) => {
        const isSelected = index === selectedGameIndex;
        const itemHtml = `
            <div class="fgp-game-item ${isSelected ? 'selected' : ''}" data-index="${index}">
                <div class="fgp-game-info">
                    <span class="fgp-game-name">${game.name}</span>
                    <span class="fgp-game-file">${game.file}</span>
                </div>
                <button class="fgp-delete-btn menu_button red_button" title="삭제">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        `;
        $container.append(itemHtml);
    });

    // 리스트 아이템 클릭 (선택)
    $('.fgp-game-item').on('click', function(e) {
        // 삭제 버튼 클릭 시 이벤트 전파 방지 처리 필요 없음 (별도 핸들링)
        if ($(e.target).closest('.fgp-delete-btn').length) return;

        selectedGameIndex = $(this).data('index');
        renderGameList(); // 다시 그려서 선택 스타일 적용
        
        const gameName = settings.gameList[selectedGameIndex].name;
        $('#fgp_play_selected_btn').prop('disabled', false).html(`<i class="fa-solid fa-play"></i> '${gameName}' 실행`);
    });

    // 삭제 버튼 클릭
    $('.fgp-delete-btn').on('click', function(e) {
        e.stopPropagation();
        const index = $(this).closest('.fgp-game-item').data('index');
        if (confirm(`${settings.gameList[index].name}을(를) 목록에서 삭제합니까?`)) {
            settings.gameList.splice(index, 1);
            if (selectedGameIndex === index) selectedGameIndex = -1;
            if (selectedGameIndex > index) selectedGameIndex--; // 인덱스 밀림 보정
            saveSettingsDebounced();
            renderGameList();
        }
    });
}

(async function() {
    // 설정 로드 및 초기화
    settings = extension_settings[extensionName] = extension_settings[extensionName] || DEFAULT_SETTINGS;
    if (!settings.pos) settings.pos = DEFAULT_SETTINGS.pos;
    
    migrateGameList();
    await loadRuffleEngine();

    try {
        const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
        $("#extensions_settings2").append(settingsHtml);
        
        // 1. 게임 리스트 렌더링
        renderGameList();

        // 2. 모달 관련 이벤트
        const $modal = $('#fgp_add_modal');
        const $filenameInput = $('#fgp_input_filename');
        const $displaynameInput = $('#fgp_input_displayname');

        $('#fgp_open_add_modal_btn').on('click', () => {
            $filenameInput.val('');
            $displaynameInput.val('');
            $modal.removeClass('fgp-hidden');
            $filenameInput.focus();
        });

        $('#fgp_modal_cancel').on('click', () => {
            $modal.addClass('fgp-hidden');
        });

        $('#fgp_modal_save').on('click', () => {
            const file = $filenameInput.val().trim();
            let name = $displaynameInput.val().trim();
            
            if (!file) {
                alert('파일명을 입력해주세요.');
                return;
            }
            if (!file.endsWith('.swf')) {
                alert('.swf 확장자를 포함해주세요.');
                return;
            }
            if (!name) name = file; // 별칭 없으면 파일명 사용

            // 중복 체크 (파일명 기준)
            if (settings.gameList.some(g => g.file === file)) {
                alert('이미 등록된 파일명입니다.');
                return;
            }

            settings.gameList.push({ file: file, name: name });
            saveSettingsDebounced();
            renderGameList();
            $modal.addClass('fgp-hidden');
        });

        // 3. 실행 버튼 이벤트
        $('#fgp_play_selected_btn').on('click', () => {
            if (selectedGameIndex >= 0 && settings.gameList[selectedGameIndex]) {
                const game = settings.gameList[selectedGameIndex];
                const gamePath = `${extensionFolderPath}/games/${game.file}`;
                createFlashPopup(gamePath, game.name);
            }
        });

        // 4. 로컬 파일 실행
        $('#fgp_local_file_input').on('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                const fileUrl = URL.createObjectURL(file);
                createFlashPopup(fileUrl, file.name);
                // 입력 초기화
                $(this).val('');
            }
        });

        // 5. 고급 설정 토글
        $('#fgp_toggle_advanced').on('click', function() {
            const $content = $('#fgp_advanced_content');
            const $icon = $(this).find('i');
            if ($content.hasClass('fgp-hidden')) {
                $content.removeClass('fgp-hidden');
                $icon.attr('class', 'fa-solid fa-chevron-up');
            } else {
                $content.addClass('fgp-hidden');
                $icon.attr('class', 'fa-solid fa-chevron-down');
            }
        });

        // 6. 기본 볼륨 설정 연동
        $('#fgp_default_volume').val(settings.volume);
        $('#fgp_default_volume').on('input', function() {
            settings.volume = parseFloat($(this).val());
            saveSettingsDebounced();
        });

    } catch (e) {
        console.error(`[${extensionName}] Error loading settings:`, e);
    }
})();