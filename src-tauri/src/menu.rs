// lil-kit: shared file — edit ~/lil-kit/web/src-tauri/src/menu.rs, then run ~/lil-kit/sync.sh
// The suite's native menu bar. Every lil app shows the same items in its own UI
// language: the frontend calls `lil_menu` on start and again whenever the language
// changes (src/lib/menu.ts), and gets clicks on our own items back as the
// "lil-menu" event carrying the item name ("settings", "updates", "open", "theme").
//
// macOS only. On Windows and Linux a menu bar would be drawn inside the window,
// which the apps never had, so there `lil_menu` does nothing.
//
// Wiring in lib.rs:  .on_menu_event(menu::on_event)
//                    .invoke_handler(tauri::generate_handler![menu::lil_menu, …])

use serde::Deserialize;
use tauri::menu::{AboutMetadata, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter};
use tauri_plugin_opener::OpenerExt;

/// "owner/name" from `repository` in Cargo.toml, when it points at GitHub.
pub fn github_repo() -> Option<&'static str> {
    env!("CARGO_PKG_REPOSITORY")
        .strip_prefix("https://github.com/")
        .map(|r| r.trim_end_matches('/'))
        .filter(|r| r.contains('/'))
}

/// The optional items. An item is shown only when the app has something behind it.
#[derive(Deserialize, Default)]
pub struct Features {
    #[serde(default)]
    open: bool,
    #[serde(default)]
    settings: bool,
    #[serde(default)]
    updates: bool,
    #[serde(default)]
    theme: bool,
}

struct Texts {
    about: &'static str,
    settings: &'static str,
    updates: &'static str,
    services: &'static str,
    hide: &'static str,
    hide_others: &'static str,
    show_all: &'static str,
    quit: &'static str,
    file: &'static str,
    open: &'static str,
    close: &'static str,
    edit: &'static str,
    undo: &'static str,
    redo: &'static str,
    cut: &'static str,
    copy: &'static str,
    paste: &'static str,
    select_all: &'static str,
    view: &'static str,
    theme: &'static str,
    fullscreen: &'static str,
    window: &'static str,
    minimize: &'static str,
    zoom: &'static str,
    front: &'static str,
    help: &'static str,
    site: &'static str,
}

// Wording follows macOS's own Russian menus, so our items sit naturally next to
// the ones the system adds (Services, the Window list).
const RU: Texts = Texts {
    about: "О программе",
    settings: "Настройки…",
    updates: "Проверить обновления…",
    services: "Службы",
    hide: "Скрыть",
    hide_others: "Скрыть остальные",
    show_all: "Показать все",
    quit: "Завершить",
    file: "Файл",
    open: "Открыть…",
    close: "Закрыть окно",
    edit: "Правка",
    undo: "Отменить",
    redo: "Повторить",
    cut: "Вырезать",
    copy: "Скопировать",
    paste: "Вставить",
    select_all: "Выбрать все",
    view: "Вид",
    theme: "Светлая / тёмная тема",
    fullscreen: "Войти в полноэкранный режим",
    window: "Окно",
    minimize: "Свернуть",
    zoom: "Изменить масштаб",
    front: "Все окна — на передний план",
    help: "Справка",
    site: "Страница программы на GitHub",
};

const EN: Texts = Texts {
    about: "About",
    settings: "Settings…",
    updates: "Check for Updates…",
    services: "Services",
    hide: "Hide",
    hide_others: "Hide Others",
    show_all: "Show All",
    quit: "Quit",
    file: "File",
    open: "Open…",
    close: "Close Window",
    edit: "Edit",
    undo: "Undo",
    redo: "Redo",
    cut: "Cut",
    copy: "Copy",
    paste: "Paste",
    select_all: "Select All",
    view: "View",
    theme: "Light / Dark Theme",
    fullscreen: "Enter Full Screen",
    window: "Window",
    minimize: "Minimize",
    zoom: "Zoom",
    front: "Bring All to Front",
    help: "Help",
    site: "Project Page on GitHub",
};

fn build(app: &AppHandle, lang: &str, f: &Features) -> tauri::Result<Menu<tauri::Wry>> {
    let t = if lang == "ru" { &RU } else { &EN };
    let name = app.package_info().name.clone();
    let sep = || PredefinedMenuItem::separator(app);
    let item = |id: &str, text: &str, accel: Option<&str>| {
        MenuItem::with_id(app, format!("lil.{id}"), text, true, accel)
    };

    let about = AboutMetadata {
        name: Some(name.clone()),
        version: Some(app.package_info().version.to_string()),
        copyright: Some("lil software".into()),
        website: github_repo().map(|r| format!("https://github.com/{r}")),
        ..Default::default()
    };
    let app_menu = Submenu::with_items(
        app,
        &name,
        true,
        &[&PredefinedMenuItem::about(app, Some(&format!("{} {name}", t.about)), Some(about))?],
    )?;
    if f.settings || f.updates {
        app_menu.append(&sep()?)?;
    }
    if f.settings {
        app_menu.append(&item("settings", t.settings, Some("CmdOrCtrl+,"))?)?;
    }
    if f.updates {
        app_menu.append(&item("updates", t.updates, None)?)?;
    }
    app_menu.append_items(&[
        &sep()?,
        &PredefinedMenuItem::services(app, Some(t.services))?,
        &sep()?,
        &PredefinedMenuItem::hide(app, Some(&format!("{} {name}", t.hide)))?,
        &PredefinedMenuItem::hide_others(app, Some(t.hide_others))?,
        &PredefinedMenuItem::show_all(app, Some(t.show_all))?,
        &sep()?,
        &PredefinedMenuItem::quit(app, Some(&format!("{} {name}", t.quit)))?,
    ])?;

    let file = Submenu::new(app, t.file, true)?;
    if f.open {
        file.append_items(&[&item("open", t.open, Some("CmdOrCtrl+O"))?, &sep()?])?;
    }
    file.append(&PredefinedMenuItem::close_window(app, Some(t.close))?)?;

    let edit = Submenu::with_items(
        app,
        t.edit,
        true,
        &[
            &PredefinedMenuItem::undo(app, Some(t.undo))?,
            &PredefinedMenuItem::redo(app, Some(t.redo))?,
            &sep()?,
            &PredefinedMenuItem::cut(app, Some(t.cut))?,
            &PredefinedMenuItem::copy(app, Some(t.copy))?,
            &PredefinedMenuItem::paste(app, Some(t.paste))?,
            &PredefinedMenuItem::select_all(app, Some(t.select_all))?,
        ],
    )?;

    let view = Submenu::new(app, t.view, true)?;
    if f.theme {
        view.append_items(&[&item("theme", t.theme, None)?, &sep()?])?;
    }
    view.append(&PredefinedMenuItem::fullscreen(app, Some(t.fullscreen))?)?;

    let window = Submenu::with_items(
        app,
        t.window,
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some(t.minimize))?,
            &PredefinedMenuItem::maximize(app, Some(t.zoom))?,
            &sep()?,
            &PredefinedMenuItem::bring_all_to_front(app, Some(t.front))?,
        ],
    )?;

    let menu = Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window])?;
    if github_repo().is_some() {
        let help = Submenu::with_items(app, t.help, true, &[&item("site", t.site, None)?])?;
        menu.append(&help)?;
    }
    Ok(menu)
}

#[tauri::command]
pub fn lil_menu(app: AppHandle, lang: String, features: Features) -> Result<(), String> {
    if cfg!(target_os = "macos") {
        let menu = build(&app, &lang, &features).map_err(|e| e.to_string())?;
        app.set_menu(menu).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn on_event(app: &AppHandle, event: MenuEvent) {
    let Some(id) = event.id().as_ref().strip_prefix("lil.") else {
        return;
    };
    if id == "site" {
        if let Some(r) = github_repo() {
            let _ = app.opener().open_url(format!("https://github.com/{r}"), None::<&str>);
        }
        return;
    }
    let _ = app.emit("lil-menu", id);
}
