#!/bin/zsh
# Локальная сборка для этого Мака и установка в /Applications.
#
# Подписывает сертификатом Apple Development, если он есть (Apple ID в Xcode).
# Ради «Полного доступа к диску», без которого не читаются куки Сафари: macOS
# привязывает разрешение к подписи, а у сборки «без имени» (ad hoc) она своя у
# каждой сборки — и разрешение слетало после каждой пересборки. Сборка для
# GitHub по-прежнему ad hoc (tauri.conf.json), этот сценарий её не трогает.
set -e
cd "${0:A:h}"
APP="lil download"
# Папка, имя которой кончается на .noindex, Spotlight не обходит. Иначе каждая
# сборка оставляет в поиске ещё один «lil download.app» рядом с настоящим.
# Через переменную, а не через .cargo/config.toml: воркфлоу на GitHub ищет
# готовые сборки в src-tauri/target, и файл с настройкой их бы там не оставил.
export CARGO_TARGET_DIR="$PWD/src-tauri/target.noindex"
BUILT="$CARGO_TARGET_DIR/release/bundle/macos/$APP.app"
LSR=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

ID=$(security find-identity -v -p codesigning | sed -nE 's/.*"(Apple Development: [^"]+)".*/\1/p' | head -1)
if [[ -n "$ID" ]]; then
  export APPLE_SIGNING_IDENTITY="$ID"
  echo "Подписываю: $ID"
else
  echo "Сертификата Apple Development нет — собираю без подписи (разрешения macOS будут слетать)"
fi

npm run tauri build -- --bundles app
# Копия в папке сборки не должна перехватывать ссылки lildownload://.
$LSR -u "$BUILT" 2>/dev/null || true
ditto "$BUILT" "/Applications/$APP.app.new"
# Старая версия уходит в корзину, а не стирается: если новая не заведётся,
# есть куда вернуться. Перед этим её нужно разрегистрировать — иначе в поиске
# останется призрак.
if [[ -e "/Applications/$APP.app" ]]; then
  $LSR -u "/Applications/$APP.app" 2>/dev/null || true
  mv "/Applications/$APP.app" "$HOME/.Trash/$APP $(date +%Y-%m-%d\ %H.%M.%S).app"
fi
mv "/Applications/$APP.app.new" "/Applications/$APP.app"
$LSR -f "/Applications/$APP.app"
codesign -dv "/Applications/$APP.app" 2>&1 | grep -E "^Authority=|^Signature=" | head -1
echo "Установлено: /Applications/$APP.app"
