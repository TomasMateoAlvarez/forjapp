import Foundation
import UserNotifications

// Recordatorios locales del plan semanal — sin backend ni APNs (fuera de
// alcance: no hay deploy a la nube). Se reprograman cada vez que se guarda
// un plan: se cancelan los pendientes de esta app y se agenda uno por día
// planificado que todavía no está hecho, a una hora fija.
enum NotificationManager {
    private static let reminderHour = 9
    private static let reminderMinute = 0
    private static let categoryPrefix = "forja-plan-"

    static func requestAuthorizationIfNeeded() {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            guard settings.authorizationStatus == .notDetermined else { return }
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
        }
    }

    // days: pares (fecha "yyyy-MM-dd", etiqueta del entreno planificado) de
    // días futuros (incluyendo hoy) que todavía no están marcados como hechos.
    static func cancelReminder(for date: String) {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [categoryPrefix + date])
    }

    static func rescheduleWeeklyReminders(days: [(date: String, label: String)]) {
        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { pending in
            let ours = pending.filter { $0.identifier.hasPrefix(categoryPrefix) }.map(\.identifier)
            center.removePendingNotificationRequests(withIdentifiers: ours)

            let formatter = DateFormatter()
            formatter.dateFormat = "yyyy-MM-dd"
            let now = Date()

            for day in days {
                guard let date = formatter.date(from: day.date) else { continue }
                var comps = Calendar.current.dateComponents([.year, .month, .day], from: date)
                comps.hour = reminderHour
                comps.minute = reminderMinute
                guard let fireDate = Calendar.current.date(from: comps), fireDate > now else { continue }

                let content = UNMutableNotificationContent()
                content.title = "Hoy toca entrenar"
                content.body = day.label
                content.sound = .default

                let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
                let request = UNNotificationRequest(identifier: categoryPrefix + day.date, content: content, trigger: trigger)
                center.add(request)
            }
        }
    }
}
