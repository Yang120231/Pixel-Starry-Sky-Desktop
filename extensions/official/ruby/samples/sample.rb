# frozen_string_literal: true

require "json"
require_relative "support/helpers"

=begin
Block comment: a small order-processing sample used to test highlighting.
=end

module Shop
  VERSION = "1.2.0"
  MAX_ITEMS = 100
  TAX_RATES = { "CN" => 0.13, "US" => 0.07, default: 0.0 }.freeze

  class Error < StandardError; end

  # An item in an order.
  Item = Struct.new(:name, :price, :quantity, keyword_init: true) do
    def total
      price * quantity
    end
  end

  class Order
    include Comparable
    extend Forwardable

    attr_reader :id, :items
    attr_accessor :country

    def_delegators :@items, :size, :empty?

    @@count = 0

    def self.build(id, **attrs)
      new(id, attrs.fetch(:country, "CN")).tap do |order|
        Array(attrs[:items]).each { |item| order.add(item) }
      end
    end

    def initialize(id, country = "CN")
      @id = id
      @country = country
      @items = []
      @@count += 1
    end

    def add(item)
      raise Error, "too many items: #{@items.size}" if @items.size >= MAX_ITEMS

      @items << item
      self
    end

    def subtotal
      @items.sum(&:total)
    end

    def tax
      rate = TAX_RATES.fetch(country) { TAX_RATES[:default] }
      (subtotal * rate).round(2)
    end

    def <=>(other)
      subtotal <=> other.subtotal
    end

    def to_h
      { id: id, country: country, total: subtotal + tax, items: items.map(&:to_h) }
    end

    def to_json(*args) = to_h.to_json(*args)

    def describe
      case size
      when 0 then "empty"
      when 1..3 then "small"
      else "large (#{size} items)"
      end
    end

    private

    def log(message, level: :info)
      warn "[#{level.to_s.upcase}] #{message}" unless level == :debug
    end
  end
end

order = Shop::Order.build(42, country: "US", items: [
  Shop::Item.new(name: "pen", price: 3.5, quantity: 4),
  Shop::Item.new(name: 'notebook', price: 12, quantity: 2),
])

puts <<~TEXT
  Order #{order.id}: #{order.describe}
  Total: #{format("%.2f", order.subtotal + order.tax)}
TEXT

pattern = %r{\A(?<year>\d{4})-(?<month>\d{2})\z}
if (m = pattern.match("2026-10"))
  puts "year=#{m[:year]} month=#{m[:month]}"
end

begin
  order.add(nil.fetch(:x))
rescue NoMethodError, Shop::Error => e
  puts e.message
ensure
  puts :done
end

%w[a b c].each_with_index do |s, i|
  puts "#{i}: #{s}" if i.even? && s != "b"
end

hex = 0xff + 0b1010 + 1_000 + 1.5e3
puts hex.to_s(16), $stdout.sync, __FILE__
