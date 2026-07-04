import Foundation

struct WorkoutType: Codable, Identifiable, Hashable {
    let id: String
    let label: String
    let muscle_group: String
}

struct SessionSetInput: Codable {
    let weight_kg: Double
    let reps: Int
}

struct SessionExerciseInput: Codable {
    let exercise_name: String
    let sets: [SessionSetInput]
}

struct CreateSessionPayload: Codable {
    let date: String
    let workout_type_id: String?
    let custom_routine_id: Int?
    let exercises: [SessionExerciseInput]
}

struct CustomRoutine: Codable, Identifiable {
    let id: Int
    let name: String
    let created_at: String
}

struct CreateRoutinePayload: Codable {
    let name: String
    let exercises: [String]
}

struct SessionSummary: Codable, Identifiable {
    let id: Int
    let date: String
    let workout_type_id: String
    let workout_label: String
}

struct AlertCheck: Codable {
    let warning: Bool
    let message: String?
}

struct HistoryEntry: Codable, Identifiable {
    var id: String { date + String(weight_kg) + String(set_number) }
    let date: String
    let weight_kg: Double
    let reps: Int
    let set_number: Int
}

struct LatestSet: Codable {
    let weight_kg: Double
    let reps: Int
    let set_number: Int
}

struct ExerciseInfo: Codable, Identifiable {
    var id: String { exercise_name }
    let exercise_name: String
    let default_rest_seconds: Int
    let target_sets: Int?
    let target_reps: String?
}

struct NewRecord: Codable {
    let exercise_name: String
    let type: String // "weight" or "volume"
}

struct SessionResult: Codable {
    let id: Int
    let date: String
    let new_records: [NewRecord]
}

struct PersonalRecord: Codable {
    let exercise_name: String
    let best_weight_kg: Double
    let best_weight_date: String
    let best_volume: Double
    let best_volume_date: String
}

struct ExerciseListEntry: Codable, Identifiable {
    var id: String { exercise_name }
    let exercise_name: String
    let entries: Int
    let last_date: String
}

struct Biometric: Codable, Identifiable {
    let id: Int
    let date: String
    let weight_kg: Double?
    let height_cm: Double?
    let feeling: Int?
}

struct BiometricPayload: Codable {
    let date: String
    var weight_kg: Double?
    var feeling: Int?
}

struct PlanDay: Codable {
    let date: String
    let planned_workout_type_id: String?
    let planned_label: String?
    let actual_workout_type_id: String?
    let actual_label: String?
    let done: Bool
}

struct PlanDayInput: Codable {
    let date: String
    let workout_type_id: String
}

struct SavePlanPayload: Codable {
    let week_start: String
    let days: [PlanDayInput]
}

struct PlanResponse: Codable {
    let week_start: String
    let days: [PlanDay]
}

struct PlannedDay: Codable {
    let workout_type_id: String
    let workout_label: String
}

struct UserProfile: Codable {
    let height_cm: Double?
}
