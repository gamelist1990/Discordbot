
// Vector Class
export interface Vector3 {
    x: number;
    y: number;
    z: number;
}

export interface Vector2 {
    x: number;
    y: number;
}

export interface VectorXZ {
    x: number;
    z: number;
}


export class Vector {
    /**
     * ベクトルの成分を格納する配列（読み取り専用）
     */
    public readonly components: number[];

    /**
     * Vectorクラスのコンストラクタ
     * @param components ベクトルの成分を表す数値の配列
     */
    constructor(components: number[]) {
        if (!components || components.length === 0) {
            throw new Error("Vector components cannot be empty.");
        }
        // 配列をコピーして、外部からの変更を防ぐ
        this.components = [...components];
    }

    /**
     * ベクトルの次元（成分の数）を取得します。
     * @returns {number} ベクトルの次元
     */
    get dimension(): number {
        return this.components.length;
    }

    /**
     * 別のベクトルとの次元が同じかチェックします。
     * @param other 比較対象のベクトル
     * @throws {Error} 次元が異なる場合にエラーをスローします
     * @private
     */
    private checkDimension(other: Vector): void {
        if (this.dimension !== other.dimension) {
            throw new Error(`Vectors must have the same dimension (current: ${this.dimension}, other: ${other.dimension}).`);
        }
    }

    /**
     * このベクトルと別のベクトルの加算を行います。
     * 元のベクトルは変更されません。
     * @param other 加算するベクトル
     * @returns {Vector} 加算結果の新しいベクトル
     * @throws {Error} 次元が異なる場合にエラーをスローします
     */
    add(other: Vector): Vector {
        this.checkDimension(other);
        const newComponents = this.components.map((comp, index) => comp + other.components[index]);
        return new Vector(newComponents);
    }

    /**
     * このベクトルから別のベクトルを減算します。
     * 元のベクトルは変更されません。
     * @param other 減算するベクトル
     * @returns {Vector} 減算結果の新しいベクトル
     * @throws {Error} 次元が異なる場合にエラーをスローします
     */
    subtract(other: Vector): Vector {
        this.checkDimension(other);
        const newComponents = this.components.map((comp, index) => comp - other.components[index]);
        return new Vector(newComponents);
    }

    /**
     * このベクトルをスカラー値で乗算（スケーリング）します。
     * 元のベクトルは変更されません。
     * @param scalar 乗算するスカラー値
     * @returns {Vector} スケーリングされた新しいベクトル
     */
    scale(scalar: number): Vector {
        const newComponents = this.components.map(comp => comp * scalar);
        return new Vector(newComponents);
    }

    /**
     * このベクトルと別のベクトルのドット積（内積）を計算します。
     * @param other ドット積を計算する相手のベクトル
     * @returns {number} ドット積の結果
     * @throws {Error} 次元が異なる場合にエラーをスローします
     */
    dot(other: Vector): number {
        this.checkDimension(other);
        return this.components.reduce((sum, comp, index) => sum + comp * other.components[index], 0);
    }

    /**
     * ベクトルの大きさ（マグニチュード、ノルム）を計算します。
     * @returns {number} ベクトルの大きさ
     */
    magnitude(): number {
        // magnitude = sqrt(v.v)
        return Math.sqrt(this.dot(this));
    }

    /**
     * ベクトルを正規化します（単位ベクトルを生成します）。
     * 元のベクトルは変更されません。
     * ゼロベクトルの場合は、同じ次元のゼロベクトルを返します。
     * @returns {Vector} 正規化された新しいベクトル（単位ベクトル）
     */
    normalize(): Vector {
        const mag = this.magnitude();
        if (mag === 0) {
            // ゼロベクトルを正規化しようとした場合、ゼロベクトルを返す
            return new Vector(new Array(this.dimension).fill(0));
        }
        return this.scale(1 / mag);
    }

    /**
     * このベクトルと別のベクトルの間の距離を計算します。
     * distance = |v1 - v2|
     * @param other 距離を計算する相手のベクトル
     * @returns {number} 2つのベクトル間の距離
     * @throws {Error} 次元が異なる場合にエラーをスローします
     */
    distanceTo(other: Vector): number {
        return this.subtract(other).magnitude();
    }

    /**
     * このベクトルが別のベクトルと等しいかどうかを比較します。
     * 浮動小数点数の誤差を考慮する場合は、epsilonを指定します。
     * @param other 比較対象のベクトル
     * @param epsilon 許容誤差 (デフォルト: 0)
     * @returns {boolean} ベクトルが等しい場合はtrue、そうでない場合はfalse
     */
    equals(other: Vector, epsilon: number = 0): boolean {
        if (this.dimension !== other.dimension) {
            return false;
        }
        for (let i = 0; i < this.dimension; i++) {
            if (Math.abs(this.components[i] - other.components[i]) > epsilon) {
                return false;
            }
        }
        return true;
    }

    /**
     * ベクトルの文字列表現を返します。
     * @returns {string} 例: "Vector(1, 2, 3)"
     */
    toString(): string {
        return `Vector(${this.components.join(', ')})`;
    }

    // --- 静的メソッド ---

    /**
     * 指定された次元のゼロベクトルを作成します。
     * @param dimension ベクトルの次元
     * @returns {Vector} ゼロベクトル
     */
    static zero(dimension: number): Vector {
        if (dimension <= 0) {
            throw new Error("Dimension must be positive.");
        }
        return new Vector(new Array(dimension).fill(0));
    }

    /**
     * 2つのベクトルを加算する静的メソッド。
     * @param v1 1つ目のベクトル
     * @param v2 2つ目のベクトル
     * @returns {Vector} 加算結果の新しいベクトル
     */
    static add(v1: Vector, v2: Vector): Vector {
        return v1.add(v2);
    }

    /**
     * 1つ目のベクトルから2つ目のベクトルを減算する静的メソッド。
     * @param v1 1つ目のベクトル
     * @param v2 2つ目のベクトル
     * @returns {Vector} 減算結果の新しいベクトル
     */
    static subtract(v1: Vector, v2: Vector): Vector {
        return v1.subtract(v2);
    }

    /**
     * ベクトルをスカラー倍する静的メソッド。
     * @param v ベクトル
     * @param scalar スカラー値
     * @returns {Vector} スケーリングされた新しいベクトル
     */
    static scale(v: Vector, scalar: number): Vector {
        return v.scale(scalar);
    }

    /**
     * 2つのベクトルのドット積を計算する静的メソッド。
     * @param v1 1つ目のベクトル
     * @param v2 2つ目のベクトル
     * @returns {number} ドット積の結果
     */
    static dot(v1: Vector, v2: Vector): number {
        return v1.dot(v2);
    }
}
