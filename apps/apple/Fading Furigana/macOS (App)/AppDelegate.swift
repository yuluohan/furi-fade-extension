//
//  AppDelegate.swift
//  macOS (App)
//
//  Created by 韩雨洛 on 2026/6/11.
//

import Cocoa

@main
class AppDelegate: NSObject, NSApplicationDelegate {

    func applicationDidFinishLaunching(_ notification: Notification) {
        // The storyboard menu was stripped to App + Help, so settings could only be
        // reached from an in-window button. Build a standard macOS menu bar instead so
        // Settings is a first-class ⌘, item and text fields get the usual Edit commands.
        Self.rebuildMainMenu()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    static func rebuildMainMenu() {
        NSApp.mainMenu = buildMainMenu()
    }

    private static func buildMainMenu() -> NSMenu {
        let appName = Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String ?? "Fading Furigana"
        let mainMenu = NSMenu()

        // App menu
        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appItem.submenu = appMenu
        appMenu.addItem(withTitle: L.f("About %@", appName), action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: L.t("Settings…"), action: #selector(ViewController.openSettings(_:)), keyEquivalent: ",")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: L.f("Hide %@", appName), action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = appMenu.addItem(withTitle: L.t("Hide Others"), action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: L.t("Show All"), action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: L.f("Quit %@", appName), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        // Edit menu (standard responder-chain editing actions for text fields)
        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let editMenu = NSMenu(title: L.t("Edit"))
        editItem.submenu = editMenu
        editMenu.addItem(withTitle: L.t("Undo"), action: Selector(("undo:")), keyEquivalent: "z")
        let redo = editMenu.addItem(withTitle: L.t("Redo"), action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: L.t("Cut"), action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: L.t("Copy"), action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: L.t("Paste"), action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: L.t("Delete"), action: #selector(NSText.delete(_:)), keyEquivalent: "")
        editMenu.addItem(withTitle: L.t("Select All"), action: #selector(NSStandardKeyBindingResponding.selectAll(_:)), keyEquivalent: "a")

        // Window menu
        let windowItem = NSMenuItem()
        mainMenu.addItem(windowItem)
        let windowMenu = NSMenu(title: L.t("Window"))
        windowItem.submenu = windowMenu
        windowMenu.addItem(withTitle: L.t("Minimize"), action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: L.t("Zoom"), action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        let fullScreen = windowMenu.addItem(withTitle: L.t("Enter Full Screen"), action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullScreen.keyEquivalentModifierMask = [.command, .control]
        NSApp.windowsMenu = windowMenu

        // Help menu
        let helpItem = NSMenuItem()
        mainMenu.addItem(helpItem)
        let helpMenu = NSMenu(title: L.t("Help"))
        helpItem.submenu = helpMenu
        helpMenu.addItem(withTitle: L.f("%@ Help", appName), action: #selector(NSApplication.showHelp(_:)), keyEquivalent: "?")
        NSApp.helpMenu = helpMenu

        return mainMenu
    }

}
