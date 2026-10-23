#!/bin/zsh
# Сборка и установка помощника «lil download Safari» — кнопки lil download в Сафари.
# Один экземпляр, в ~/Applications. Сделано по образцу ~/AI dev/lil/lil-xvideo/build.sh.
# Если в Xcode добавлен Apple ID (есть сертификат Apple Development) — подписывает им,
# тогда Safari не сбрасывает «Разрешить неподписанные расширения» при каждом запуске.
set -e
cd "${0:A:h}"
APP_NAME="lil download Safari"
DEST="$HOME/Applications/$APP_NAME.app"
LSR=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

for f in ../extension/*.js; do node --check "$f" || exit 1; done
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer

# Team ID — это поле OU в сертификате (а не число в скобках в его названии).
TEAM=""
if security find-identity -v -p codesigning | grep -q "Apple Development"; then
  TEAM=$(security find-certificate -c "Apple Development" -p 2>/dev/null \
    | openssl x509 -noout -subject 2>/dev/null | sed -nE 's/.*OU ?= ?([A-Z0-9]{10}).*/\1/p' | head -1)
fi
if [[ -n "$TEAM" ]]; then
  SIGN=(CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM=$TEAM -allowProvisioningUpdates)
  echo "Подписываю командой $TEAM"
else
  SIGN=(CODE_SIGN_IDENTITY=-)
  echo "Сертификата нет — собираю без подписи"
fi

LOG=$(mktemp)
if ! xcodebuild -project "$APP_NAME/$APP_NAME.xcodeproj" -scheme "$APP_NAME" -configuration Release \
     -derivedDataPath build build "${SIGN[@]}" >"$LOG" 2>&1; then
  grep -E "error:" "$LOG" | head -20
  echo "ОШИБКА: сборка не прошла (полный лог: $LOG)"
  exit 1
fi
echo "Сборка прошла"

BUILT="build/Build/Products/Release/$APP_NAME.app"
RES="$BUILT/Contents/PlugIns/$APP_NAME Extension.appex/Contents/Resources"
for f in ../extension/*; do
  [[ -e "$RES/${f:t}" ]] || { echo "ОШИБКА: ${f:t} не попал в приложение — добавь его в проект Xcode"; exit 1; }
done

osascript -e "quit app \"$APP_NAME\"" 2>/dev/null || true
rm -rf "$DEST"
mkdir -p "$HOME/Applications"
# Переносим, а не копируем: вторая копия в папке сборки даёт Safari второе расширение.
$LSR -u "$PWD/$BUILT" 2>/dev/null || true
mv "$BUILT" "$DEST"
for p in build/Build/Products/*/"$APP_NAME.app"(N) build/Build/Products/*/"$APP_NAME Extension.appex"(N); do
  [[ -e "$p" ]] || continue
  $LSR -u "$PWD/$p" 2>/dev/null || true
  rm -rf "$p"
done
# Регистрируем и убеждаемся, что Safari видит расширение (иногда с первого раза не цепляется).
for attempt in 1 2 3 4 5; do
  $LSR -f -R "$DEST"
  pluginkit -a "$DEST/Contents/PlugIns/$APP_NAME Extension.appex" 2>/dev/null || true
  sleep 2
  if pluginkit -mAvvv -p com.apple.Safari.web-extension 2>/dev/null | grep -q "$DEST/Contents/PlugIns"; then
    echo "Расширение зарегистрировано"
    break
  fi
  [[ $attempt == 5 ]] && echo "ВНИМАНИЕ: система не видит расширение — открой приложение «$APP_NAME» вручную"
done
codesign -dv "$DEST" 2>&1 | grep -E "Authority=|Signature=" | head -2
