import Foundation

struct WorkoutType: Codable, Identifiable, Hashable {
    let id: String
    let label: String
    let muscle_group: String
}

struct SessionSetInput: Codable {
    let weight_kg: Double
    let reps: Int
    var rir: Int?
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
    var rpe: Int?
    var started_at: String?
    var ended_at: String?
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
    let workout_type_id: String?
    let custom_routine_id: Int?
    let workout_label: String
    let rpe: Int?
}

struct SessionExerciseSet: Codable, Identifiable {
    var id: String { exercise_name + String(set_number) }
    let exercise_name: String
    let weight_kg: Double
    let reps: Int
    let set_number: Int
}

struct SessionDetail: Codable, Identifiable {
    let id: Int
    let date: String
    let workout_type_id: String?
    let custom_routine_id: Int?
    let workout_label: String
    let rpe: Int?
    let tonelaje_total: Double
    let peso_medio: Double?
    let intensidad_promedio_pct: Double?
    let started_at: String?
    let ended_at: String?
    let indice_hipertrofia: Double?
    let coeficiente_hipertrofia: Double?
    let exercises: [SessionExerciseSet]
}

struct PrsByWeekdayEntry: Codable, Identifiable {
    var id: Int { weekday_index }
    let weekday_index: Int
    let label: String
    let count: Int
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
    let training_mode: String?
    let pro_enabled: Bool
}

struct TrainingModeConfig: Codable, Identifiable {
    var id: String { mode }
    let mode: String
    let label: String
    let rep_range_min: Int
    let rep_range_max: Int
    let rest_seconds: Int
    let progression_rir_threshold: Int
}

struct RestSuggestion: Codable {
    let rest_seconds: Int
    let zone: String?
    let note: String?
}

struct ProgressionSuggestion: Codable {
    let mode: String
    let action: String // "subir_peso" | "mantener" | "bajar" | "sin_datos"
    let reason: String
}

struct SuggestedPlanDay: Codable {
    let weekday_index: Int
    let workout_type_id: String?
}

struct SuggestedPlanResponse: Codable {
    let days: [SuggestedPlanDay]
}

struct AuthUser: Codable, Equatable {
    let id: Int
    let email: String
}

struct AuthCredentials: Encodable {
    let email: String
    let password: String
}

struct AuthResponse: Decodable {
    let token: String
    let user: AuthUser
}

struct InviteCode: Codable {
    let code: String
}

struct PendingRequest: Codable, Identifiable {
    let id: Int
    let coach_user_id: Int
    let coach_email: String
    let created_at: String
}

struct StrengthTestPayload: Encodable {
    let date: String
    let test_type: String // "salto_simple" | "drop_jump"
    let flight_time_sec: Double
    var contact_time_sec: Double?
    var drop_height_cm: Double?
}

struct StrengthTest: Codable, Identifiable {
    let id: Int
    let date: String
    let test_type: String
    let flight_time_sec: Double
    let contact_time_sec: Double?
    let drop_height_cm: Double?
    let jump_height_cm: Double
    let reactive_stability_q: Double?
}

struct CardioSessionPayload: Encodable {
    let date: String
    let activity_type: String // "cardio" | "tecnico_tactico" | "otro"
    let duration_min: Int
    var notes: String?
}

struct CardioSession: Codable, Identifiable {
    let id: Int
    let date: String
    let activity_type: String
    let duration_min: Int
    let notes: String?
}

struct CoachAthlete: Codable, Identifiable {
    var id: Int { athlete_user_id }
    let athlete_user_id: Int
    let athlete_email: String
    let adherence_pct: Double?
    let last_check_in: String?
}
