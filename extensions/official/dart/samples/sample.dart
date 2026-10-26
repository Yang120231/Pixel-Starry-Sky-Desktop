// 示例：订单服务，覆盖注释、字符串、数字、关键字、函数、类型。
library order_service;

import 'dart:async';
import 'dart:convert' show jsonEncode;
import 'package:collection/collection.dart' as collection;

part 'order_service.g.dart';

/// 订单状态。
enum Status { created, paid, shipped }

/* 价格相关的常量 */
const double taxRate = 0.0825;
const int maxItems = 0x7FFF;
final String greeting = 'hello, "world"\n';
final String multi = '''
第一行 ${taxRate * 100}%
第二行 $maxItems
''';
final raw = r'C:\temp\$not_interpolated';

mixin Describable {
  String describe();
}

abstract class Shape {
  double get area;
}

class Circle extends Shape with Describable {
  Circle(this.radius);

  final double radius;

  @override
  double get area => 3.14159 * radius * radius;

  @override
  String describe() => 'Circle($radius)';
}

class Order {
  Order({required this.id, required this.items, this.status = Status.created});

  final String id;
  final List<String> items;
  Status status;

  factory Order.fromJson(Map<String, dynamic> json) {
    return Order(
      id: json['id'] as String,
      items: (json['items'] as List<dynamic>).cast<String>(),
    );
  }

  Map<String, Object?> toJson() => {'id': id, 'items': items, 'status': status.name};
}

extension OrderX on Order {
  bool get isEmpty => items.isEmpty;
}

class OrderService {
  final Map<String, Order> _orders = {};

  Order? find(String id) => _orders[id];

  Future<Order> load(String id) async {
    await Future<void>.delayed(const Duration(milliseconds: 10));
    final order = find(id);
    if (order == null) {
      throw StateError('订单不存在: $id');
    }
    return order;
  }

  Stream<int> counter(int n) async* {
    for (var i = 0; i < n; i++) {
      yield i;
    }
  }

  String summary() {
    try {
      final total = _orders.values.fold<int>(0, (sum, o) => sum + o.items.length);
      return jsonEncode({'total': total, 'ok': true, 'none': null});
    } on FormatException catch (e) {
      return 'error: ${e.message}';
    } finally {
      print('done');
    }
  }
}

void main(List<String> args) {
  final service = OrderService();
  var count = 1_000;
  switch (count) {
    case 0:
      print('empty');
    default:
      print('count = $count, ${1.5e3}');
  }
  print(collection.IterableEquality().equals([1, 2], [1, 2]));
}
