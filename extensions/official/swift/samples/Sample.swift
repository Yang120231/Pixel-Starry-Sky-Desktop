// Sample.swift: 语法测速用示例
import Foundation

/// 订单状态
enum OrderStatus: String, Codable, CaseIterable {
    case pending, paid, shipped
    case cancelled = "CANCELLED"

    var isFinal: Bool { self == .shipped || self == .cancelled }
}

struct Order: Identifiable, Hashable {
    let id: UUID
    var title: String
    var amount: Decimal = 0.0
    var status: OrderStatus = .pending
    var tags: [String: Int] = ["new": 1, "vip": 0x10]

    mutating func pay() throws {
        guard status == .pending else {
            throw OrderError.invalidState(status)
        }
        status = .paid
    }
}

enum OrderError: Error {
    case invalidState(OrderStatus)
    case notFound(id: UUID)
}

protocol OrderStore: AnyObject {
    associatedtype Item
    func load(id: UUID) async throws -> Item
}

actor MemoryStore {
    private var items: [UUID: Order] = [:]

    func load(id: UUID) async throws -> Order {
        guard let order = items[id] else { throw OrderError.notFound(id: id) }
        return order
    }

    func save(_ order: Order) { items[order.id] = order }
}

extension Order: CustomStringConvertible {
    var description: String { "Order(\(title), \(amount)) #\(status.rawValue)" }
}

@MainActor
final class ViewModel: ObservableObject {
    @Published var orders: [Order] = []
    private let store = MemoryStore()

    func refresh() async {
        do {
            let order = try await store.load(id: UUID())
            orders.append(order)
        } catch OrderError.notFound(let id) {
            print("missing \(id)")
        } catch {
            print("error: \(error)")
        }
    }
}

func total<S: Sequence>(of items: S) -> Double where S.Element == Order {
    items.reduce(0.0) { $0 + ($1.amount as NSDecimalNumber).doubleValue }
}

let sample = Order(id: UUID(), title: "Book", amount: 12.5)
let names = [sample].map { $0.title }.filter { !$0.isEmpty }
let multi = """
    多行字符串
    value = \(sample.amount)
    """
let pattern = #"\d+"#
/* 块注释
   第二行 */
if #available(macOS 13, *) { print(names, multi, pattern, 1_000, 3.14e2, true, nil as Int?) }
