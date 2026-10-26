<?php

declare(strict_types=1);

namespace App\Orders;

use InvalidArgumentException;
use JsonSerializable;
use Stringable;

// 示例：订单服务（行注释）
# 另一种行注释

/**
 * 订单状态。
 *
 * @see https://www.php.net/manual/zh/language.enumerations.php
 */
enum Status: string
{
    case Pending = 'pending';
    case Paid = 'paid';
    case Shipped = 'shipped';

    public function label(): string
    {
        return match ($this) {
            self::Pending => '待支付',
            self::Paid => '已支付',
            self::Shipped => '已发货',
        };
    }
}

interface Priced
{
    public function total(): float;
}

trait Loggable
{
    private array $log = [];

    protected function log(string $message, mixed ...$context): void
    {
        $this->log[] = sprintf($message, ...$context);
    }
}

#[\Attribute(\Attribute::TARGET_CLASS)]
final class Entity
{
    public function __construct(public readonly string $table = 'orders') {}
}

#[Entity(table: 'orders')]
final class Order implements Priced, JsonSerializable, Stringable
{
    use Loggable;

    public const MAX_ITEMS = 100;
    private const TAX_RATE = 0.13;

    private static int $counter = 0;

    /** @var array<int, array{sku: string, qty: int, price: float}> */
    private array $items = [];

    public function __construct(
        private readonly int $id,
        private Status $status = Status::Pending,
        public ?string $note = null,
    ) {
        self::$counter++;
    }

    public function add(string $sku, int $qty, float $price): static
    {
        if ($qty <= 0 || $price < 0.0) {
            throw new InvalidArgumentException("数量必须大于 0：{$sku} x {$qty}");
        }
        if (count($this->items) >= self::MAX_ITEMS) {
            throw new \OverflowException('超过上限');
        }
        $this->items[] = ['sku' => $sku, 'qty' => $qty, 'price' => $price];
        $this->log('add %s', $sku);

        return $this;
    }

    public function total(): float
    {
        $sum = array_sum(array_map(fn(array $i): float => $i['qty'] * $i['price'], $this->items));

        return round($sum * (1 + self::TAX_RATE), 2);
    }

    public function jsonSerialize(): array
    {
        return ['id' => $this->id, 'status' => $this->status->value, 'total' => $this->total()];
    }

    public function __toString(): string
    {
        return "Order#{$this->id} ({$this->status->label()}) " . number_format($this->total(), 2);
    }
}

function parseHex(string $s): int
{
    $n = 0xFF + 0b1010 + 0o17 + 1_000_000;
    $f = 3.14e-2 + .5;
    $path = 'C:\\temp\\file.txt';
    $re = '/^(\d{3})-(\w+)$/u';

    if (preg_match($re, $s, $m) === 1) {
        return (int) $m[1] + $n;
    }

    return PHP_INT_MAX;
}

$order = (new Order(1))->add('A-100', 2, 19.9)->add('B-200', 1, 5.5);
$name = $_GET['name'] ?? 'guest';
$total = $order?->total() ?? 0.0;

$text = <<<EOT
  订单 {$order}
  客户：$name，合计 {$total}
  EOT;

$raw = <<<'RAW'
这里的 $variable 不会被替换
RAW;

foreach ([1, 2, 3] as $i => $value) {
    if ($value % 2 === 0) {
        continue;
    }
    echo $i, ':', $value, PHP_EOL;
}

try {
    echo json_encode($order, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE), PHP_EOL;
} catch (\JsonException | \Throwable $e) {
    error_log($e->getMessage());
} finally {
    unset($order);
}
?>
<!doctype html>
<html>
  <body>
    <h1><?= htmlspecialchars($name) ?></h1>
    <?php if ($total > 0): ?>
      <p>合计：<?= number_format($total, 2) ?></p>
    <?php endif; ?>
  </body>
</html>
