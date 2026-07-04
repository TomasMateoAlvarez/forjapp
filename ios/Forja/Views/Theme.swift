import SwiftUI

extension Color {
    static let forjaBg = Color(red: 0x15/255, green: 0x17/255, blue: 0x1b/255)
    static let forjaPanel = Color(red: 0x1d/255, green: 0x20/255, blue: 0x25/255)
    static let forjaPanel2 = Color(red: 0x22/255, green: 0x26/255, blue: 0x2c/255)
    static let forjaLine = Color(red: 0x33/255, green: 0x38/255, blue: 0x3f/255)
    static let forjaEmber = Color(red: 0xff/255, green: 0x5a/255, blue: 0x36/255)
    static let forjaBrass = Color(red: 0xd9/255, green: 0xa5/255, blue: 0x4a/255)
    static let forjaChalk = Color(red: 0xf2/255, green: 0xf1/255, blue: 0xec/255)
    static let forjaSteel = Color(red: 0x97/255, green: 0xa0/255, blue: 0xa8/255)
}

struct ForjaCard<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 12) { content }
            .padding(16)
            .background(Color.forjaPanel)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.forjaLine, lineWidth: 1))
            .cornerRadius(8)
    }
}

struct ForjaPrimaryButton: View {
    let title: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title.uppercased())
                .font(.system(size: 14, weight: .semibold, design: .default))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Color.forjaEmber)
                .foregroundColor(Color.forjaBg)
                .cornerRadius(8)
        }
    }
}

struct ForjaEyebrow: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .medium, design: .monospaced))
            .foregroundColor(.forjaBrass)
            .tracking(1.5)
    }
}
