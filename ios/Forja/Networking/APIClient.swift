import Foundation

enum APIError: Error { case network; case server(String) }

// Identificador de tenant para el backend multi-cliente. Por default es
// 'default' para TODAS las instalaciones (iOS y web comparten el mismo
// historial de una sola persona, como hasta ahora). Si algún día se despliega
// este backend para más de una persona, este dispositivo podría fijar su
// propio client_id (ej. vía Info.plist) para tener su propio tenant aislado.
enum ClientIdentity {
    private static let key = "forja_client_id"

    static var current: String = {
        if let existing = UserDefaults.standard.string(forKey: key) {
            return existing
        }
        let id = "default"
        UserDefaults.standard.set(id, forKey: key)
        return id
    }()
}

final class APIClient {
    static let shared = APIClient()

    // En simulador, "localhost" apunta a tu Mac (donde corre el backend).
    // En un iPhone físico, reemplazá por la IP local de tu Mac, ej: "http://192.168.1.23:4000/api"
    private let baseURL = "http://localhost:4000/api"

    private func request<T: Decodable>(_ path: String, method: String = "GET", body: Encodable? = nil) async throws -> T {
        var req = URLRequest(url: URL(string: baseURL + path)!)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(ClientIdentity.current, forHTTPHeaderField: "X-Client-Id")
        if let body = body {
            req.httpBody = try JSONEncoder().encode(AnyEncodable(body))
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: req)
        } catch {
            throw APIError.network
        }
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw APIError.server("Error de red")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    func getWorkoutTypes() async throws -> [WorkoutType] {
        try await request("/workout-types")
    }

    func getExercises(for typeId: String) async throws -> [ExerciseInfo] {
        try await request("/workout-types/\(typeId)/exercises")
    }

    func checkAlert(typeId: String, date: String) async throws -> AlertCheck {
        try await request("/alerts/check?workout_type_id=\(typeId)&date=\(date)")
    }

    func createSession(_ payload: CreateSessionPayload) async throws -> SessionResult {
        try await request("/sessions", method: "POST", body: payload)
    }

    func getExerciseRecords(_ name: String) async throws -> PersonalRecord? {
        let encoded = name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? name
        struct NullableRecord: Decodable {
            let value: PersonalRecord?
            init(from decoder: Decoder) throws {
                let container = try decoder.singleValueContainer()
                value = container.decodeNil() ? nil : try container.decode(PersonalRecord.self)
            }
        }
        let wrapper: NullableRecord = try await request("/history/\(encoded)/records")
        return wrapper.value
    }

    func getSessions() async throws -> [SessionSummary] {
        try await request("/sessions")
    }

    func getExerciseList() async throws -> [ExerciseListEntry] {
        try await request("/history")
    }

    func getExerciseHistory(_ name: String) async throws -> [HistoryEntry] {
        let encoded = name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? name
        return try await request("/history/\(encoded)")
    }

    func upsertBiometric(_ payload: BiometricPayload) async throws {
        struct Empty: Decodable {}
        let _: Empty = try await request("/biometrics", method: "POST", body: payload)
    }

    func getBiometrics() async throws -> [Biometric] {
        try await request("/biometrics")
    }

    func savePlan(_ payload: SavePlanPayload) async throws {
        struct Empty: Decodable {}
        let _: Empty = try await request("/weekly-plan", method: "POST", body: payload)
    }

    func getPlan(weekStart: String) async throws -> PlanResponse {
        try await request("/weekly-plan/\(weekStart)")
    }

    func markPlanDayDone(weekStart: String, date: String) async throws {
        struct Body: Encodable { let date: String }
        struct Empty: Decodable {}
        let _: Empty = try await request("/weekly-plan/\(weekStart)/mark-done", method: "POST", body: Body(date: date))
    }

    func getLatestSets(for exerciseName: String) async throws -> [LatestSet] {
        let encoded = exerciseName.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? exerciseName
        return try await request("/history/\(encoded)/latest")
    }

    func getCustomRoutines() async throws -> [CustomRoutine] {
        try await request("/custom-routines")
    }

    func createCustomRoutine(_ payload: CreateRoutinePayload) async throws -> CustomRoutine {
        try await request("/custom-routines", method: "POST", body: payload)
    }

    func deleteCustomRoutine(_ id: Int) async throws {
        struct Empty: Decodable {}
        let _: Empty = try await request("/custom-routines/\(id)", method: "DELETE")
    }

    func getCustomRoutineExercises(_ id: Int) async throws -> [ExerciseInfo] {
        try await request("/custom-routines/\(id)/exercises")
    }

    func getPlannedForDate(_ date: String) async throws -> PlannedDay? {
        struct NullableDay: Decodable {
            let value: PlannedDay?
            init(from decoder: Decoder) throws {
                let container = try decoder.singleValueContainer()
                value = container.decodeNil() ? nil : try container.decode(PlannedDay.self)
            }
        }
        let wrapper: NullableDay = try await request("/weekly-plan/for-date/\(date)")
        return wrapper.value
    }

    func addExercise(_ name: String, to typeId: String, targetSets: Int? = nil, targetReps: String? = nil) async throws {
        struct Body: Encodable { let exercise_name: String; let target_sets: Int?; let target_reps: String? }
        struct Empty: Decodable {}
        let _: Empty = try await request("/workout-types/\(typeId)/exercises", method: "POST", body: Body(exercise_name: name, target_sets: targetSets, target_reps: targetReps))
    }

    func patchExercise(_ name: String, in typeId: String, targetSets: Int?, targetReps: String?) async throws {
        struct Body: Encodable { let target_sets: Int?; let target_reps: String? }
        struct Empty: Decodable {}
        let encoded = name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? name
        let _: Empty = try await request("/workout-types/\(typeId)/exercises/\(encoded)", method: "PATCH", body: Body(target_sets: targetSets, target_reps: targetReps))
    }

    func removeExercise(_ name: String, from typeId: String) async throws {
        struct Empty: Decodable {}
        let encoded = name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? name
        let _: Empty = try await request("/workout-types/\(typeId)/exercises/\(encoded)", method: "DELETE")
    }

    func addExerciseToRoutine(_ name: String, routineId: Int, targetSets: Int? = nil, targetReps: String? = nil) async throws {
        struct Body: Encodable { let exercise_name: String; let target_sets: Int?; let target_reps: String? }
        struct Empty: Decodable {}
        let _: Empty = try await request("/custom-routines/\(routineId)/exercises", method: "POST", body: Body(exercise_name: name, target_sets: targetSets, target_reps: targetReps))
    }

    func patchRoutineExercise(_ name: String, routineId: Int, targetSets: Int?, targetReps: String?) async throws {
        struct Body: Encodable { let target_sets: Int?; let target_reps: String? }
        struct Empty: Decodable {}
        let encoded = name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? name
        let _: Empty = try await request("/custom-routines/\(routineId)/exercises/\(encoded)", method: "PATCH", body: Body(target_sets: targetSets, target_reps: targetReps))
    }

    func removeExerciseFromRoutine(_ name: String, routineId: Int) async throws {
        struct Empty: Decodable {}
        let encoded = name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? name
        let _: Empty = try await request("/custom-routines/\(routineId)/exercises/\(encoded)", method: "DELETE")
    }

    func getProfile() async throws -> UserProfile {
        try await request("/profile")
    }

    func putProfile(heightCm: Double) async throws {
        struct Body: Encodable { let height_cm: Double }
        struct Empty: Decodable {}
        let _: Empty = try await request("/profile", method: "PUT", body: Body(height_cm: heightCm))
    }
}

// Helper para poder mandar cualquier Encodable como body sin pelearse con generics
private struct AnyEncodable: Encodable {
    private let encodeFunc: (Encoder) throws -> Void
    init(_ wrapped: Encodable) { self.encodeFunc = wrapped.encode }
    func encode(to encoder: Encoder) throws { try encodeFunc(encoder) }
}
