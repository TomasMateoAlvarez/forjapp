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

    // Viene de API_BASE_URL en Info.plist, seteado por build setting/xcconfig
    // (ios/Config/Debug.xcconfig y Release.xcconfig) — no hace falta editar
    // código para cambiarlo. En simulador, "localhost" apunta a tu Mac (donde
    // corre el backend). En un iPhone físico, reemplazá el valor en el
    // xcconfig correspondiente por la IP local de tu Mac, ej: "http://192.168.1.23:4000/api"
    private let baseURL: String = {
        Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String ?? "http://localhost:4000/api"
    }()

    private func request<T: Decodable>(_ path: String, method: String = "GET", body: Encodable? = nil) async throws -> T {
        var req = URLRequest(url: URL(string: baseURL + path)!)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(ClientIdentity.current, forHTTPHeaderField: "X-Client-Id")
        // Si hay sesión iniciada, el token manda sobre el X-Client-Id legacy
        // (el server lo verifica igual que hace con el frontend web).
        if let token = AuthSession.shared.token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
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

    func getExerciseRecords(_ name: String, asAthleteId: Int? = nil) async throws -> PersonalRecord? {
        let encoded = name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? name
        struct NullableRecord: Decodable {
            let value: PersonalRecord?
            init(from decoder: Decoder) throws {
                let container = try decoder.singleValueContainer()
                value = container.decodeNil() ? nil : try container.decode(PersonalRecord.self)
            }
        }
        let wrapper: NullableRecord = try await request(withAthleteParam("/history/\(encoded)/records", asAthleteId))
        return wrapper.value
    }

    func getSessions(asAthleteId: Int? = nil) async throws -> [SessionSummary] {
        try await request(withAthleteParam("/sessions", asAthleteId))
    }

    func getExerciseList(asAthleteId: Int? = nil) async throws -> [ExerciseListEntry] {
        try await request(withAthleteParam("/history", asAthleteId))
    }

    func getPrsByWeekday(asAthleteId: Int? = nil) async throws -> [PrsByWeekdayEntry] {
        try await request(withAthleteParam("/history/prs-by-weekday", asAthleteId))
    }

    func getSessionDetail(_ id: Int, asAthleteId: Int? = nil) async throws -> SessionDetail {
        try await request(withAthleteParam("/sessions/\(id)", asAthleteId))
    }

    func getExerciseHistory(_ name: String, asAthleteId: Int? = nil) async throws -> [HistoryEntry] {
        let encoded = name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? name
        return try await request(withAthleteParam("/history/\(encoded)", asAthleteId))
    }

    func upsertBiometric(_ payload: BiometricPayload) async throws {
        struct Empty: Decodable {}
        let _: Empty = try await request("/biometrics", method: "POST", body: payload)
    }

    func getBiometrics(asAthleteId: Int? = nil) async throws -> [Biometric] {
        try await request(withAthleteParam("/biometrics", asAthleteId))
    }

    func savePlan(_ payload: SavePlanPayload) async throws {
        struct Empty: Decodable {}
        let _: Empty = try await request("/weekly-plan", method: "POST", body: payload)
    }

    func getPlan(weekStart: String, asAthleteId: Int? = nil) async throws -> PlanResponse {
        try await request(withAthleteParam("/weekly-plan/\(weekStart)", asAthleteId))
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

    func putProfile(heightCm: Double? = nil, trainingMode: String? = nil, proEnabled: Bool? = nil) async throws {
        struct Body: Encodable { let height_cm: Double?; let training_mode: String?; let pro_enabled: Bool? }
        struct Empty: Decodable {}
        let _: Empty = try await request("/profile", method: "PUT", body: Body(height_cm: heightCm, training_mode: trainingMode, pro_enabled: proEnabled))
    }

    func getTrainingModes() async throws -> [TrainingModeConfig] {
        try await request("/profile/training-modes")
    }

    func getProgressionSuggestion(exerciseName: String, mode: String?) async throws -> ProgressionSuggestion {
        let encoded = exerciseName.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? exerciseName
        let path = "/history/\(encoded)/suggestion"
        return try await request(mode.map { "\(path)?mode=\($0)" } ?? path)
    }

    func getSuggestedPlan() async throws -> SuggestedPlanResponse {
        try await request("/weekly-plan/suggested")
    }

    func getRestSuggestion(exerciseName: String, weightKg: Double) async throws -> RestSuggestion {
        let encoded = exerciseName.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? exerciseName
        return try await request("/history/\(encoded)/rest-suggestion?weight_kg=\(weightKg)")
    }

    func register(email: String, password: String) async throws -> AuthResponse {
        try await request("/auth/register", method: "POST", body: AuthCredentials(email: email, password: password))
    }

    // Se llama con el token de la cuenta recién creada, ANTES de guardar la
    // sesión en AuthSession (por eso no usa request(), que manda el token ya
    // guardado) — ver AccountView.swift.
    func migrateAnonymousData(token: String, anonymousClientId: String) async throws {
        struct Body: Encodable { let anonymous_client_id: String }
        var req = URLRequest(url: URL(string: baseURL + "/auth/migrate-anonymous-data")!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.httpBody = try JSONEncoder().encode(Body(anonymous_client_id: anonymousClientId))
        _ = try await URLSession.shared.data(for: req)
    }

    func login(email: String, password: String) async throws -> AuthResponse {
        try await request("/auth/login", method: "POST", body: AuthCredentials(email: email, password: password))
    }

    func logout() async throws {
        struct Empty: Decodable {}
        let _: Empty = try await request("/auth/logout", method: "POST")
    }

    // MARK: - Coach

    func getInviteCode() async throws -> InviteCode? {
        struct NullableCode: Decodable {
            let value: InviteCode?
            init(from decoder: Decoder) throws {
                let container = try decoder.singleValueContainer()
                value = container.decodeNil() ? nil : try container.decode(InviteCode.self)
            }
        }
        let wrapper: NullableCode = try await request("/coach/invite-code")
        return wrapper.value
    }

    func generateInviteCode() async throws -> InviteCode {
        try await request("/coach/invite-code", method: "POST")
    }

    func requestCoachLink(code: String) async throws {
        struct Body: Encodable { let code: String }
        struct Empty: Decodable {}
        let _: Empty = try await request("/coach/link-requests", method: "POST", body: Body(code: code))
    }

    func getPendingRequests() async throws -> [PendingRequest] {
        try await request("/coach/pending-requests")
    }

    func acceptLinkRequest(_ id: Int) async throws {
        struct Empty: Decodable {}
        let _: Empty = try await request("/coach/link-requests/\(id)/accept", method: "POST")
    }

    func rejectLinkRequest(_ id: Int) async throws {
        struct Empty: Decodable {}
        let _: Empty = try await request("/coach/link-requests/\(id)/reject", method: "POST")
    }

    func getCoachAthletes() async throws -> [CoachAthlete] {
        try await request("/coach/athletes")
    }

    // MARK: - Strength tests (saltos/pliometría)

    func createStrengthTest(_ payload: StrengthTestPayload) async throws -> StrengthTest {
        try await request("/strength-tests", method: "POST", body: payload)
    }

    func getStrengthTests(asAthleteId: Int? = nil) async throws -> [StrengthTest] {
        try await request(withAthleteParam("/strength-tests", asAthleteId))
    }

    // MARK: - Cardio sessions

    func createCardioSession(_ payload: CardioSessionPayload) async throws -> CardioSession {
        try await request("/cardio-sessions", method: "POST", body: payload)
    }

    func getCardioSessions(asAthleteId: Int? = nil) async throws -> [CardioSession] {
        try await request(withAthleteParam("/cardio-sessions", asAthleteId))
    }
}

private func withAthleteParam(_ path: String, _ asAthleteId: Int?) -> String {
    guard let asAthleteId else { return path }
    let sep = path.contains("?") ? "&" : "?"
    return "\(path)\(sep)as_athlete_id=\(asAthleteId)"
}

// Helper para poder mandar cualquier Encodable como body sin pelearse con generics
private struct AnyEncodable: Encodable {
    private let encodeFunc: (Encoder) throws -> Void
    init(_ wrapped: Encodable) { self.encodeFunc = wrapped.encode }
    func encode(to encoder: Encoder) throws { try encodeFunc(encoder) }
}
